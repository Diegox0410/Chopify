import { auth } from '../auth/firebaseClient'

export async function adminCall<T>(operation: string, tenantId?: string, input: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new Error('La sesión expiró. Inicia sesión nuevamente.')
  const token = await user.getIdToken()
  const response = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ operation, tenantId, input, idempotencyKey }),
  })
  const body = await response.json() as { ok?: boolean; data?: T; error?: string }
  if (!response.ok || !body.ok) throw new Error(body.error || 'No fue posible completar la operación')
  return body.data as T
}
