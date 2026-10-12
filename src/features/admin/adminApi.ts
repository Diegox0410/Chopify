import { auth } from '../../auth/firebaseClient'
import { setQuotaSafeMode } from '../../hooks/quotaMode'

type AdminEnvelope<T> = { ok?: boolean; data?: T; error?: string; errorCode?: string; upstreamStatus?: number; upstreamService?: string; upstreamOperation?: string; upstreamCode?: string; notification?: { status?: string } }
type CachedRead = { value: unknown; expiresAt: number }
type ReadFailure = { error: Error; expiresAt: number; attempts: number }
const readOperations = new Set(['dashboard', 'commandCenterSnapshot', 'notificationsSnapshot'])
const readCache = new Map<string, CachedRead>()
const readInFlight = new Map<string, Promise<unknown>>()
const readFailures = new Map<string, ReadFailure>()
const READ_CACHE_MS = 8_000
const MAX_READ_BACKOFF_MS = 120_000

class AdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs = 0) { super(message); this.name = 'AdminApiError' }
}

function clearReadCache(tenantId: string) {
  const shouldClear = (key: string) => tenantId === 'all' || key.startsWith('notificationsSnapshot:') || key.includes(`:${tenantId}:`)
  for (const key of readCache.keys()) if (shouldClear(key)) readCache.delete(key)
  for (const key of readFailures.keys()) if (shouldClear(key)) readFailures.delete(key)
}

export async function adminApi<T>(operation: string, tenantId: string, input: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
  const isRead = readOperations.has(operation)
  const key = `${operation}:${tenantId}:${JSON.stringify(input)}`
  if (isRead) {
    const cached = readCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value as T
    if (cached) readCache.delete(key)
    const failure = readFailures.get(key)
    if (failure && failure.expiresAt > Date.now()) throw failure.error
    if (failure) readFailures.delete(key)
    const pending = readInFlight.get(key)
    if (pending) return pending as Promise<T>
  }

  const request = async (): Promise<T> => {
  const token = await adminIdToken()
  const response = await fetch('/api/admin', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ operation, tenantId, input, ...(idempotencyKey ? { idempotencyKey } : {}) }),
    cache: 'no-store',
  })
  setQuotaSafeMode(response.headers.get('x-firestore-quota-safe-mode') === 'true')
  const envelope = await response.json().catch(() => ({})) as AdminEnvelope<T>
  if (!response.ok || envelope.ok !== true) {
    if (response.status === 401) throw new Error('La sesión administrativa no está autorizada.')
    if (response.status === 403) throw new Error('Tu usuario no tiene permisos para esta operación o tenant.')
    const retryAfterSeconds = Number(response.headers.get('retry-after')) || 0
    throw new AdminApiError(envelope.error || 'No fue posible completar la operación administrativa.', response.status, retryAfterSeconds * 1000)
  }
  if (envelope.notification && envelope.notification.status !== 'SENT') {
    throw new Error(`La operación se guardó, pero la notificación WhatsApp quedó en ${envelope.notification.status || 'estado desconocido'}. Requiere revisión.`)
  }
  if (!isRead) clearReadCache(tenantId)
  return envelope.data as T
  }

  if (!isRead) return request()
  const pending = request().then(value => {
    readCache.set(key, { value, expiresAt: Date.now() + READ_CACHE_MS })
    readFailures.delete(key)
    return value
  }).catch(error => {
    const status = Number((error as { status?: number })?.status)
    if (status === 429 || status === 503) {
      const previous = readFailures.get(key)
      const attempts = (previous?.attempts ?? 0) + 1
      const backoff = Math.min(30_000 * 2 ** (attempts - 1), MAX_READ_BACKOFF_MS) * (0.8 + Math.random() * 0.4)
      const retryAfter = Number((error as { retryAfterMs?: number })?.retryAfterMs) || 0
      readFailures.set(key, { error: error instanceof Error ? error : new Error('Lectura administrativa fallida.'), expiresAt: Date.now() + Math.max(backoff, retryAfter), attempts })
    }
    throw error
  }).finally(() => readInFlight.delete(key))
  readInFlight.set(key, pending)
  return pending as Promise<T>
}

export async function adminIdToken(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new Error('La sesión administrativa no está disponible.')
  return user.getIdToken()
}

export async function fetchPaymentProof(tenantId: string, proofId: string): Promise<Blob> {
  const token = await adminIdToken()
  const query = new URLSearchParams({ tenantId, proofId })
  const response = await fetch(`/api/payment-proof?${query}`, {
    headers: { accept: 'image/*, application/pdf', authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('No se pudo cargar el comprobante.')
  return response.blob()
}

export async function adminApiForScope<T>(operation: string, scope: string, input: Record<string, unknown> = {}): Promise<T[]> {
  const tenants = scope === 'ALL' ? ['tenant-floes', 'tenant-mg', 'tenant-dgng'] : [scope]
  return (await Promise.all(tenants.map((tenantId) => adminApi<T[]>(operation, tenantId, input)))).flat()
}

export const adminOperationKey = (operation: string, id: string) => {
  const storageKey = `idempotency:chopify-ui:${operation}:${id}`
  const existing = sessionStorage.getItem(storageKey)
  if (existing) return existing
  const created = crypto.randomUUID()
  sessionStorage.setItem(storageKey, created)
  return created
}
