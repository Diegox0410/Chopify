import { createHash } from 'node:crypto'
import { authorizeChannelInbound } from './channelInboundAuth.js'
import { ConversationError, recordChannelOutboundMessage } from './conversationStore.js'
import { getLiveRecord, commitLiveRecords, queryLiveDocuments } from './live.js'
import { isKnownTenant } from '../../src/config/tenantRegistry.js'

const channelProviders = Object.freeze({ INSTAGRAM: 'META', FACEBOOK: 'META', WEB: 'WEB', TIKTOK: 'TIKTOK' })
const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(JSON.stringify(body))
}
const header = (headers, name) => {
  const value = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  return Array.isArray(value) ? value[0] || '' : value || ''
}
const parse = body => typeof body === 'string' ? JSON.parse(body) : body && typeof body === 'object' && !Array.isArray(body) ? body : {}
const identifier = (value, max = 512) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null
const digest = ({ tenantId, conversationId, customerId, channel, correlationId }) => createHash('sha256').update(`${tenantId}:${conversationId}:${customerId}:${channel}:${correlationId}`).digest('hex')
const responseError = error => ({ status: error instanceof ConversationError ? error.status : 503, code: error instanceof ConversationError ? error.code : 'CHANNEL_OUTBOUND_UNAVAILABLE' })

export function createChannelOutboundHandler(dependencies = {}) {
  const authorize = dependencies.authorize || authorizeChannelInbound
  const store = dependencies.store || { get: getLiveRecord, commit: commitLiveRecords, query: queryLiveDocuments }
  return async function channelOutboundHandler(req, res) {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
    const access = await authorize(req)
    if (!access) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' })
    let body
    try {
      body = parse(req.body)
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 12000) return json(res, 413, { ok: false, error: 'PAYLOAD_TOO_LARGE' })
    } catch { return json(res, 400, { ok: false, error: 'INVALID_JSON' }) }
    const tenantId = identifier(body.tenantId, 64)
    if (!tenantId || tenantId !== access.tenantId || !isKnownTenant(tenantId)) return json(res, 403, { ok: false, error: 'TENANT_NOT_ALLOWED' })
    const channel = typeof body.channel === 'string' ? body.channel : ''
    const provider = typeof body.provider === 'string' ? body.provider : ''
    if (!Object.hasOwn(channelProviders, channel) || channelProviders[channel] !== provider) return json(res, 400, { ok: false, error: 'CHANNEL_PROVIDER_NOT_ALLOWED' })
    const conversationId = identifier(body.conversationId, 80)
    const customerId = identifier(body.customerId, 128)
    const messageId = identifier(body.messageId, 512)
    const correlationId = identifier(body.correlationId, 512)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const createdAt = typeof body.createdAt === 'string' && Number.isFinite(Date.parse(body.createdAt)) ? new Date(body.createdAt).toISOString() : null
    if (!/^conversation_[a-f0-9]{64}$/.test(conversationId || '') || !customerId || !messageId || !correlationId
      || !text || text.length > 4000 || !createdAt || Date.parse(createdAt) > Date.now() + 300000) {
      return json(res, 400, { ok: false, error: 'INVALID_CHANNEL_OUTBOUND' })
    }
    const idempotencyKey = header(req.headers, 'Idempotency-Key')
    if (idempotencyKey !== digest({ tenantId, conversationId, customerId, channel, correlationId })) return json(res, 400, { ok: false, error: 'IDEMPOTENCY_KEY_MISMATCH' })
    try {
      const result = await recordChannelOutboundMessage({ tenantId, provider, channel, conversationId, customerId, messageId, correlationId, text, createdAt }, store)
      return json(res, 200, { conversationId: result.conversationId, customerId: result.customerId, messageId: result.messageId,
        outboxId: result.outboxId, status: result.status, duplicate: result.duplicate })
    } catch (error) {
      const failure = responseError(error)
      console.error(JSON.stringify({ service: 'channel-outbound', stage: 'request_failed', tenantId, code: failure.code, httpStatus: failure.status }))
      return json(res, failure.status, { ok: false, error: failure.code })
    }
  }
}
