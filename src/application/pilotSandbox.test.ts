import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createPilotSandboxHandler } from '../../api/pilot-sandbox'
import { channelConversationIdentity } from '../../api/_lib/conversationStore.js'

const baseEnv = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'codex/preview-final-chopify',
  VERCEL_URL: 'chopify-candidate-123-diegox-s-proyec.vercel.app',
  CHOPIFY_FIREBASE_PROJECT_ID: 'floes-commercial-sandbox-2026',
  CHOPIFY_COMMERCE_STATE_COLLECTION: 'floesCommerceSandboxState',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'floes-commercial-sandbox-2026' }),
  GANOBOT_LIVE_URL: 'https://gano-bot-candidate-diegox-s-proyec.vercel.app',
  GANOBOT_LIVE_BEARER_TOKEN: 'test-ganobot-token',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'test-preview-bypass',
  GANOBOT_VERCEL_PROTECTION_BYPASS_SECRET: 'test-ganobot-bypass',
  CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES: 'test-owner-token',
  CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES: 'test-inbound-token',
} as NodeJS.ProcessEnv

function response() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(name: string, value: string) { this.headers[name] = value },
    end(body = '') { this.body = body },
  }
}

const request = (confirmation = 'CREATE_SYNTHETIC_WEB_CONVERSATION') => ({
  method: 'POST', url: '/api/pilot-sandbox?action=synthetic-conversation', headers: {}, body: { confirmation },
})

describe('Preview synthetic conversation fixture', () => {
  it('is branch- and sandbox-gated and creates only one fixed WEB inbound without outbound transport', async () => {
    let calls = 0
    const handler = createPilotSandboxHandler({ env: baseEnv, fetch: async (url, init) => {
      calls++
      const target = new URL(String(url))
      expect(target.pathname).toBe('/api/channel-inbound')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-inbound-token')
      expect(new Headers(init?.headers).get('x-vercel-protection-bypass')).toBe('test-preview-bypass')
      const fixture = JSON.parse(String(init?.body))
      expect(fixture.tenantId).toBe('tenant-floes')
      expect(fixture.provider).toBe('WEB')
      expect(fixture.channel).toBe('WEB')
      expect(fixture.text).toContain('SYNTHETIC QA ONLY')
      expect(fixture.conversationId).toBe(channelConversationIdentity('tenant-floes', 'WEB', 'WEB', fixture.externalConversationId))
      expect(new Headers(init?.headers).get('idempotency-key')).toBe(createHash('sha256').update(`tenant-floes:WEB:WEB:${fixture.providerMessageId}`).digest('hex'))
      return Response.json({ conversationId: fixture.conversationId, duplicate: false })
    } })
    const res = response(); await handler(request(), res)
    const body = JSON.parse(res.body)
    expect(res.statusCode).toBe(200)
    expect(body).toMatchObject({ ok: true, sandbox: true, synthetic: true, tenantId: 'tenant-floes', channel: 'WEB', duplicate: false, outboundCreated: false })
    expect(calls).toBe(1)
    expect(res.body).not.toContain('test-inbound-token')
    expect(res.body).not.toContain('test-preview-bypass')
  })

  it('rejects other branches and missing confirmation before any write', async () => {
    let calls = 0
    const otherBranch = createPilotSandboxHandler({ env: { ...baseEnv, VERCEL_GIT_COMMIT_REF: 'main' }, fetch: async () => { calls++; return Response.json({}) } })
    const branchResponse = response(); await otherBranch(request(), branchResponse)
    expect(branchResponse.statusCode).toBe(404)
    const handler = createPilotSandboxHandler({ env: baseEnv, fetch: async () => { calls++; return Response.json({}) } })
    const confirmationResponse = response(); await handler(request(''), confirmationResponse)
    expect(confirmationResponse.statusCode).toBe(400)
    expect(calls).toBe(0)
  })

  it('fails closed when the tenant inbound credential is absent or upstream rejects the write', async () => {
    let calls = 0
    const missingToken = createPilotSandboxHandler({ env: { ...baseEnv, CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES: '' }, fetch: async () => { calls++; return Response.json({}) } })
    const missing = response(); await missingToken(request(), missing)
    expect(missing.statusCode).toBe(503)
    expect(calls).toBe(0)

    const rejected = createPilotSandboxHandler({ env: baseEnv, fetch: async () => Response.json({ error: 'private upstream detail' }, { status: 403 }) })
    const denied = response(); await rejected(request(), denied)
    expect(denied.statusCode).toBe(502)
    expect(denied.body).not.toContain('private upstream detail')
  })
})
