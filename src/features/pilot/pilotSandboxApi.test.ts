import { describe, expect, it, vi } from 'vitest'
import { createPilotSandboxHandler } from '../../../api/pilot-sandbox.js'

function response() {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: '',
    setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value) },
    end(body = '') { this.body = body },
  }
}

function requestUrl(action: string) { return `/api/pilot-sandbox?action=${action}` }

function readyEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'chopify-abc123456-diegox-s-proyec.vercel.app',
    CHOPIFY_FIREBASE_PROJECT_ID: 'floes-commercial-sandbox-2026',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'floes-commercial-sandbox-2026', client_email: 'sandbox@example.invalid', private_key: 'not-used-in-this-test' }),
    CHOPIFY_COMMERCE_STATE_COLLECTION: 'floesCommerceSandboxState',
    CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN: 'fake-commerce-token',
    CHOPIFY_VERCEL_PROTECTION_BYPASS_SECRET: 'fake-chopify-bypass',
    GANOBOT_VERCEL_PROTECTION_BYPASS_SECRET: 'fake-gano-bypass',
    GANOBOT_LIVE_URL: 'https://gano-bot-abc123456-diegox-s-proyec.vercel.app',
    GANOBOT_LIVE_BEARER_TOKEN: 'fake-gano-token',
    CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES: 'fake-owner-token',
    ...overrides,
  }
}

describe('Preview commercial sandbox API', () => {
  it('fails closed outside Preview before reading or writing state', async () => {
    const fetch = vi.fn()
    const handler = createPilotSandboxHandler({ env: readyEnvironment({ VERCEL_ENV: 'production' }), fetch })
    const res = response()
    await handler({ method: 'GET', url: requestUrl('health'), headers: {} }, res)
    expect(res.statusCode).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a Firebase project or collection that is not the isolated sandbox', async () => {
    const fetch = vi.fn()
    const handler = createPilotSandboxHandler({ env: readyEnvironment({ CHOPIFY_FIREBASE_PROJECT_ID: 'chopify-f9b1c' }), fetch })
    const res = response()
    await handler({ method: 'GET', url: requestUrl('health'), headers: {} }, res)
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).checks.firebaseProject).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports only sanitized isolated Preview readiness', async () => {
    const handler = createPilotSandboxHandler({ env: readyEnvironment(), fetch: vi.fn() })
    const res = response()
    await handler({ method: 'GET', url: requestUrl('health'), headers: {} }, res)
    const payload = JSON.parse(res.body)
    expect(res.statusCode).toBe(200)
    expect(payload).toMatchObject({ ready: true, sandbox: true, firebaseProjectId: 'floes-commercial-sandbox-2026', firestoreCollection: 'floesCommerceSandboxState' })
    expect(JSON.stringify(payload)).not.toMatch(/fake-(?:gano|chopify|owner)/)
  })

  it('sends only a synthetic client identity to the GanoBot Preview live endpoint', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ reply: 'Respuesta de prueba.', messages: [{ type: 'text', text: 'Respuesta de prueba.' }], commerce: { tenantId: 'tenant-floes', productId: 'pilot-daniela-test-only' } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const handler = createPilotSandboxHandler({ env: readyEnvironment(), fetch })
    const res = response()
    await handler({ method: 'POST', url: requestUrl('chat'), headers: {}, body: { message: 'Hola, ¿qué modelos tienen?', sessionId: '11111111-1111-4111-8111-111111111111', customerName: 'Cliente de prueba' } }, res)
    expect(res.statusCode).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toMatch(/^https:\/\/gano-bot-.*\.vercel\.app\/api\/live$/)
    expect(new Headers(init?.headers).get('x-vercel-protection-bypass')).toBe('fake-gano-bypass')
    expect(new Headers(init?.headers).has('x-vercel-set-bypass-cookie')).toBe(false)
    const outgoing = JSON.parse(String(init?.body))
    expect(outgoing.customer.phone).toMatch(/^999\d{9}$/)
    expect(outgoing.text).toBe('Hola, ¿qué modelos tienen?')
    expect(outgoing.paymentProofReference).toBeUndefined()
    expect(JSON.parse(res.body).selection.productId).toBe('pilot-daniela-test-only')
  })

  it('calls the Chopify owner endpoint with the bypass header and without setting a bypass cookie', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const handler = createPilotSandboxHandler({ env: readyEnvironment(), fetch })
    const res = response()
    await handler({ method: 'GET', url: requestUrl('admin'), headers: {} }, res)
    expect(res.statusCode).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(4)
    const [, init] = fetch.mock.calls[0]
    expect(new Headers(init?.headers).get('x-vercel-protection-bypass')).toBe('fake-chopify-bypass')
    expect(new Headers(init?.headers).has('x-vercel-set-bypass-cookie')).toBe(false)
  })

  it('preflights the real conversation read through Preview Owner credentials without returning conversation content', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, conversations: [{ tenantId: 'tenant-floes', id: 'conversation_test', lastMessage: 'PRIVATE MESSAGE CONTENT' }], coverage: 'INDEXED' }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const handler = createPilotSandboxHandler({ env: readyEnvironment(), fetch })
    const res = response()
    await handler({ method: 'GET', url: requestUrl('conversations'), headers: {} }, res)
    const payload = JSON.parse(res.body)
    expect(res.statusCode).toBe(200)
    expect(payload).toMatchObject({ ok: true, sandbox: true, tenantId: 'tenant-floes', upstreamStatus: 200, conversationContractValid: true, tenantPinned: true, conversationCount: 1, code: 'OK' })
    expect(String(fetch.mock.calls[0][0])).toContain('/api/conversations?tenantId=tenant-floes&view=list&limit=1')
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-chopify-access-scope')).toBe('owner')
    expect(res.body).not.toContain('PRIVATE MESSAGE CONTENT')
    expect(res.body).not.toContain('fake-owner-token')
  })

  it('surfaces only a safe Firestore diagnostic from the conversation preflight', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'FIRESTORE_COMPOSITE_INDEX_REQUIRED', detail: 'private Firestore diagnostic text' }), { status: 503, headers: { 'content-type': 'application/json' } }))
    const handler = createPilotSandboxHandler({ env: readyEnvironment(), fetch })
    const res = response()
    await handler({ method: 'GET', url: requestUrl('conversations'), headers: {} }, res)
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, sandbox: true, upstreamStatus: 503, conversationContractValid: false, code: 'FIRESTORE_COMPOSITE_INDEX_REQUIRED' })
    expect(res.body).not.toContain('private Firestore diagnostic text')
    expect(res.body).not.toContain('fake-owner-token')
  })

  it('opens only a pending synthetic transfer proof through the private Owner endpoint', async () => {
    const fixturePdf = Buffer.from('%PDF-1.4\nCOMPROBANTE FICTICIO - SANDBOX\n%%EOF')
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      if (String(url).endsWith('/api/commerce')) {
        const operation = JSON.parse(String(init?.body)).operation
        const data = operation === 'getOrderDetail'
          ? { order: { id: 'order-test', tenantId: 'tenant-floes', paymentMethod: 'MANUAL_TRANSFER_TEST' } }
          : [{ order: { id: 'order-test', tenantId: 'tenant-floes' }, payment: { id: 'payment-test' }, proof: { id: 'proof-test', orderId: 'order-test', tenantId: 'tenant-floes', status: 'PENDING', assetReference: 'sandbox-test://transfer/fixture-1' } }]
        return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(fixturePdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
    const handler = createPilotSandboxHandler({ env: readyEnvironment(), fetch })
    const res = response()
    await handler({ method: 'GET', url: '/api/pilot-sandbox?action=proof&orderId=order-test', headers: {} }, res)
    const payload = JSON.parse(res.body)
    expect(res.statusCode).toBe(200)
    expect(payload).toMatchObject({ ok: true, sandbox: true, synthetic: true, privateProofAccessible: true, upstreamStatus: 200, contentType: 'application/pdf', byteLength: fixturePdf.length, fixtureMarkerPresent: true })
    const proofRequest = fetch.mock.calls.find(([url]) => String(url).includes('/api/payment-proof'))
    expect(proofRequest).toBeTruthy()
    expect(new URL(String(proofRequest?.[0])).searchParams.get('tenantId')).toBe('tenant-floes')
    expect(new URL(String(proofRequest?.[0])).searchParams.get('proofId')).toBe('proof-test')
    expect(new Headers(proofRequest?.[1]?.headers).get('x-chopify-access-scope')).toBe('owner')
    expect(res.body).not.toContain('COMPROBANTE FICTICIO')
    expect(res.body).not.toContain('fake-owner-token')
  })

  it('refuses to proxy real or public proof references through the synthetic proof check', async () => {
    const fetch = vi.fn(async (_url: URL | string, init?: RequestInit) => {
      const operation = JSON.parse(String(init?.body)).operation
      const data = operation === 'getOrderDetail'
        ? { order: { id: 'order-test', tenantId: 'tenant-floes', paymentMethod: 'TRANSFER' } }
        : []
      return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const handler = createPilotSandboxHandler({ env: readyEnvironment(), fetch })
    const res = response()
    await handler({ method: 'GET', url: '/api/pilot-sandbox?action=proof&orderId=order-test', headers: {} }, res)
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body)).toMatchObject({ sandbox: true, synthetic: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks fixture stock through the read-only Commerce operation and returns only safe stock fields', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { available: true, availableQuantity: 2, fulfillmentMode: 'STOCK' } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const handler = createPilotSandboxHandler({ env: readyEnvironment(), fetch })
    const res = response()
    await handler({ method: 'GET', url: '/api/pilot-sandbox?action=stock&productId=pilot-daniela-test-only&variantId=pilot-daniela-vino-test-only&size=M', headers: {} }, res)
    expect(res.statusCode).toBe(200)
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/commerce$/)
    expect(JSON.parse(String(init?.body))).toMatchObject({ operation: 'checkAvailability', input: { productId: 'pilot-daniela-test-only', variantId: 'pilot-daniela-vino-test-only', size: 'M', quantity: 1 } })
    expect(new Headers(init?.headers).get('x-chopify-tenant-id')).toBe('tenant-floes')
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, sandbox: true, data: { available: true, availableQuantity: 2 } })
    expect(JSON.stringify(JSON.parse(res.body))).not.toMatch(/fake-commerce-token|fake-chopify-bypass/)
  })
})
