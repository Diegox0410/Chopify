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
})
