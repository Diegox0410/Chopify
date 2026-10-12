import { randomUUID } from 'node:crypto'
import type { CommerceGatewayOperation } from '../src/application/commerceGateway.js'
import { createTenantCommerceState, CommerceStateConflictError } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
import { testPilotProduct } from '../src/features/pilot/pilotFixture.js'

const SANDBOX_PROJECT_ID = 'floes-commercial-sandbox-2026'
const SANDBOX_COLLECTION = 'floesCommerceSandboxState'
const TENANT_ID = 'tenant-floes'
const MAX_BODY_BYTES = 16_000
const ADMIN_READS = ['listPaymentReviews', 'listOrders', 'listCustomers', 'listProducts'] as const
const ADMIN_ACTIONS = new Set<CommerceGatewayOperation>([
  'approvePayment', 'rejectPaymentProof', 'startPreparation', 'markReady', 'dispatchOrder', 'markDelivered',
])

interface ApiRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}
interface ApiResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}
interface Environment extends NodeJS.ProcessEnv {
  VERCEL_ENV?: string
}
interface HandlerDependencies {
  env?: Environment
  fetch?: typeof fetch
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function reply(response: ApiResponse, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(body))
}

function requestBody(value: unknown) {
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
    if (bytes.byteLength > MAX_BODY_BYTES) throw new RangeError('body-too-large')
    return record(JSON.parse(bytes.toString('utf8')))
  }
  const body = record(value)
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) throw new RangeError('body-too-large')
  return body
}

function readSandboxReadiness(env: Environment) {
  let serviceAccountProjectId = ''
  try {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '') as { project_id?: unknown }
    if (typeof serviceAccount.project_id === 'string') serviceAccountProjectId = serviceAccount.project_id
  } catch { /* readiness below stays false without exposing parse details */ }
  const selfHost = env.VERCEL_URL?.trim() ?? ''
  const ganoUrl = env.GANOBOT_LIVE_URL?.trim() ?? ''
  let ganoPreview = false
  try {
    const hostname = new URL(ganoUrl).hostname
    ganoPreview = hostname.startsWith('gano-bot-') && hostname.endsWith('-diegox-s-proyec.vercel.app') && hostname !== 'gano-bot-web.vercel.app'
  } catch { /* invalid URL remains not ready */ }
  const checks = {
    preview: env.VERCEL_ENV === 'preview',
    firebaseProject: env.CHOPIFY_FIREBASE_PROJECT_ID === SANDBOX_PROJECT_ID && serviceAccountProjectId === SANDBOX_PROJECT_ID,
    firestoreCollection: env.CHOPIFY_COMMERCE_STATE_COLLECTION === SANDBOX_COLLECTION,
    currentPreviewDeployment: selfHost.endsWith('.vercel.app') && !selfHost.startsWith('chopify-ten.'),
    ganoPreview: ganoPreview && Boolean(env.GANOBOT_LIVE_BEARER_TOKEN?.trim()),
    chopifyBypass: Boolean((env.VERCEL_AUTOMATION_BYPASS_SECRET ?? env.CHOPIFY_VERCEL_PROTECTION_BYPASS_SECRET)?.trim()),
    ganoBypass: Boolean(env.GANOBOT_VERCEL_PROTECTION_BYPASS_SECRET?.trim()),
    commerceOwnerToken: Boolean((env.CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES ?? env.CHOPIFY_OWNER_API_TOKEN_FLOES)?.trim()),
  }
  return { checks, ready: Object.values(checks).every(Boolean) }
}

function deploymentUrl(env: Environment) {
  const host = env.VERCEL_URL?.trim() ?? ''
  if (!/^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(host) || host.startsWith('chopify-ten.')) throw new Error('preview-deployment-invalid')
  return `https://${host}`
}

function queryAction(request: ApiRequest) {
  try { return new URL(request.url ?? '/', 'https://sandbox.invalid').searchParams.get('action') ?? '' }
  catch { return '' }
}

function fakeCustomerPhone(sessionId: string) {
  let hash = 0
  for (const char of sessionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `999${String(hash).padStart(9, '0').slice(-9)}`
}

export function createPilotSandboxHandler({ env = process.env, fetch: fetchImpl = fetch }: HandlerDependencies = {}) {
  return async function pilotSandboxHandler(request: ApiRequest, response: ApiResponse) {
    if (env.VERCEL_ENV !== 'preview') return reply(response, 404, { ok: false, error: 'Sandbox route unavailable.' })
    const action = queryAction(request)
    if (!['health', 'seed', 'chat', 'admin', 'order', 'admin-action', 'new-session'].includes(action)) return reply(response, 404, { ok: false, error: 'Sandbox route not found.' })
    const readiness = readSandboxReadiness(env)
    if (!readiness.ready) return reply(response, 503, { ok: false, error: 'Sandbox isolation or Preview connection is not ready.', checks: readiness.checks })

    const origin = deploymentUrl(env)
    const bypass = (env.VERCEL_AUTOMATION_BYPASS_SECRET ?? env.CHOPIFY_VERCEL_PROTECTION_BYPASS_SECRET)!.trim()
    const ownerToken = (env.CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES ?? env.CHOPIFY_OWNER_API_TOKEN_FLOES)!.trim()
    const tenantHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerToken}`,
      'x-chopify-tenant-id': TENANT_ID,
      'x-chopify-access-scope': 'owner',
      'x-vercel-protection-bypass': bypass,
    }

    const ownerCall = async (operation: CommerceGatewayOperation, input: Record<string, unknown> = {}) => {
      const result = await fetchImpl(`${origin}/api/commerce`, {
        method: 'POST',
        headers: tenantHeaders,
        body: JSON.stringify({ operation, input, idempotencyKey: `floes-sandbox:${operation}:${randomUUID()}` }),
        signal: AbortSignal.timeout(15_000),
      })
      const payload = record(await result.json().catch(() => ({})))
      if (!result.ok || payload.ok !== true) throw new Error(`chopify-owner-http-${result.status}`)
      return payload.data
    }

    if (request.method === 'GET' && action === 'health') {
      return reply(response, 200, { ok: true, ready: readiness.ready, sandbox: true, tenantId: TENANT_ID, firebaseProjectId: SANDBOX_PROJECT_ID, firestoreCollection: SANDBOX_COLLECTION, checks: readiness.checks, externalChannels: 'disabled', paymentProcessor: 'disabled' })
    }

    if (request.method === 'POST' && action === 'new-session') return reply(response, 200, { ok: true, sandbox: true, sessionId: randomUUID(), firestoreRecordsPreserved: true })

    if (request.method === 'GET' && action === 'admin') {
      try {
        const values = await Promise.all(ADMIN_READS.map(operation => ownerCall(operation)))
        return reply(response, 200, { ok: true, sandbox: true, tenantId: TENANT_ID, paymentReviews: values[0], orders: values[1], customers: values[2], products: values[3] })
      } catch {
        return reply(response, 502, { ok: false, error: 'Chopify Preview no respondió la lectura Owner del sandbox.' })
      }
    }

    if (request.method === 'GET' && action === 'order') {
      try {
        const orderId = new URL(request.url ?? '/', 'https://sandbox.invalid').searchParams.get('orderId')?.trim() ?? ''
        if (!/^[A-Za-z0-9._:-]{1,160}$/.test(orderId)) return reply(response, 400, { ok: false, error: 'orderId inválido.' })
        return reply(response, 200, { ok: true, sandbox: true, data: await ownerCall('getOrderDetail', { orderId }) })
      } catch {
        return reply(response, 502, { ok: false, error: 'Chopify Preview no respondió el detalle del pedido sandbox.' })
      }
    }

    if (request.method !== 'POST') return reply(response, 405, { ok: false, error: 'Method not allowed.' })

    let body: Record<string, unknown>
    try { body = requestBody(request.body) }
    catch (error) { return reply(response, error instanceof RangeError ? 413 : 400, { ok: false, error: error instanceof RangeError ? 'El mensaje supera el límite permitido.' : 'JSON inválido.' }) }

    if (action === 'seed') {
      try {
        const store = new FirestoreCommerceStateStore(env)
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const loaded = await store.load(TENANT_ID)
          const state = loaded?.state ?? createTenantCommerceState(TENANT_ID)
          const fixture = testPilotProduct(`${origin}/images/pilot/daniela-vino.jpeg`)
          if (!loaded) state.orders.products = []
          if (!state.orders.products.some(product => product.id === fixture.id)) state.orders.products.push(fixture)
          if (!state.orders.inventory.some(item => item.productId === fixture.id && item.size === 'M')) {
            state.orders.inventory.push({ tenantId: TENANT_ID, productId: fixture.id, variantId: 'pilot-daniela-vino-test-only', size: 'M', onHand: 2, reserved: 0 })
          }
          try {
            await store.save(TENANT_ID, state, loaded?.version ?? null)
            return reply(response, 200, { ok: true, sandbox: true, seeded: true, fixtureId: fixture.id, inventory: { size: 'M', onHand: 2 } })
          } catch (error) {
            if (!(error instanceof CommerceStateConflictError) || attempt === 3) throw error
          }
        }
        throw new Error('sandbox-seed-conflict')
      } catch {
        return reply(response, 502, { ok: false, error: 'No se pudo inicializar el fixture de prueba aislado.' })
      }
    }

    if (action === 'admin-action') {
      const requestedOperation = typeof body.operation === 'string' ? body.operation : ''
      const input = record(body.input)
      if (!ADMIN_ACTIONS.has(requestedOperation as CommerceGatewayOperation)) return reply(response, 400, { ok: false, error: 'Acción administrativa no permitida en el sandbox.' })
      const operation = requestedOperation as CommerceGatewayOperation
      try {
        const data = await ownerCall(operation, input)
        return reply(response, 200, { ok: true, sandbox: true, data })
      } catch {
        return reply(response, 502, { ok: false, error: 'Chopify Preview no pudo completar la acción administrativa sandbox.' })
      }
    }

    if (action === 'chat') {
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      if (!message || message.length > 1000) return reply(response, 400, { ok: false, error: 'El mensaje debe tener entre 1 y 1000 caracteres.' })
      const sessionId = typeof body.sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(body.sessionId) ? body.sessionId.toLowerCase() : randomUUID()
      const customerName = typeof body.customerName === 'string' ? body.customerName.replaceAll('<', '').replaceAll('>', '').split('').filter(char => char.charCodeAt(0) >= 0x20).join('').trim().slice(0, 100) : 'Cliente FLOES sandbox'
      const fakeProof = body.fakeProof === true
      const liveUrl = new URL('/api/live', env.GANOBOT_LIVE_URL!)
      const fakeReference = fakeProof ? `meta-whatsapp://123456789012345/media/sandbox-proof-${randomUUID().replaceAll('-', '')}` : undefined
      try {
        const result = await fetchImpl(liveUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.GANOBOT_LIVE_BEARER_TOKEN!.trim()}`,
            'Content-Type': 'application/json',
            'x-vercel-protection-bypass': env.GANOBOT_VERCEL_PROTECTION_BYPASS_SECRET!.trim(),
          },
          body: JSON.stringify({ tenantId: TENANT_ID, channel: 'WHATSAPP', providerMessageId: `sandbox-${randomUUID()}`, customer: { name: customerName || 'Cliente FLOES sandbox', phone: fakeCustomerPhone(sessionId) }, text: message, ...(fakeReference ? { paymentProofReference: fakeReference } : {}) }),
          signal: AbortSignal.timeout(30_000),
        })
        const payload = record(await result.json().catch(() => ({})))
        if (!result.ok) {
          const error = record(payload.error)
          return reply(response, 502, { ok: false, upstreamStatus: result.status, error: typeof error.code === 'string' ? error.code : 'GanoBot Preview no pudo responder.' })
        }
        const messages = Array.isArray(payload.messages) ? payload.messages.filter(item => {
          const message = record(item)
          return (message.type === 'text' && typeof message.text === 'string') || (message.type === 'image' && typeof message.url === 'string')
        }) : []
        return reply(response, 200, { ok: true, sandbox: true, sessionId, message, reply: typeof payload.reply === 'string' ? payload.reply : '', messages, selection: record(payload.commerce), requiresHuman: payload.requiresHuman === true })
      } catch {
        return reply(response, 502, { ok: false, error: 'No fue posible conectar con GanoBot Preview.' })
      }
    }

    return reply(response, 404, { ok: false, error: 'Sandbox route not found.' })
  }
}

export default createPilotSandboxHandler()
