import { createHash } from 'node:crypto'
import { authorizeChannelInbound } from './channelInboundAuth.js'
import { channelConversationIdentity, channelInboundId, ConversationError, recordChannelInboundConversation } from './conversationStore.js'
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
const safeCustomer = value => {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = {}
  if (value.name !== undefined) { if (typeof value.name !== 'string' || value.name.trim().length > 160) return null; result.name = value.name.trim() }
  if (value.phone !== undefined) { if (typeof value.phone !== 'string' || value.phone.trim().length > 40) return null; result.phone = value.phone.trim() }
  if (value.email !== undefined) {
    if (typeof value.email !== 'string' || value.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) return null
    result.email = value.email.trim()
  }
  return result
}
const idempotencyDigest = ({ tenantId, provider, channel, providerMessageId }) => createHash('sha256').update(`${tenantId}:${provider}:${channel}:${providerMessageId}`).digest('hex')
const responseError = error => ({ status: error instanceof ConversationError ? error.status : 503, code: error instanceof ConversationError ? error.code : 'CHANNEL_INBOUND_UNAVAILABLE' })

export function createChannelInboundHandler(dependencies = {}) {
  const authorize = dependencies.authorize || authorizeChannelInbound
  const store = dependencies.store || { get: getLiveRecord, commit: commitLiveRecords, query: queryLiveDocuments }
  const resolveIdentity = dependencies.resolveIdentity || (async () => { throw new ConversationError('CUSTOMER_IDENTITY_UNAVAILABLE', 503) })
  return async function channelInboundHandler(req, res) {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
    const access = await authorize(req)
    if (!access) return json(res, 401, { ok: false, error: 'UNAUTHORIZED' })
    let body
    try {
      body = parse(req.body)
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 16384) return json(res, 413, { ok: false, error: 'PAYLOAD_TOO_LARGE' })
    } catch { return json(res, 400, { ok: false, error: 'INVALID_JSON' }) }
    const tenantId = identifier(body.tenantId, 64)
    if (!tenantId || tenantId !== access.tenantId || !isKnownTenant(tenantId)) return json(res, 403, { ok: false, error: 'TENANT_NOT_ALLOWED' })
    const channel = typeof body.channel === 'string' ? body.channel : ''
    const provider = typeof body.provider === 'string' ? body.provider : ''
    if (!Object.hasOwn(channelProviders, channel) || channelProviders[channel] !== provider) return json(res, 400, { ok: false, error: 'CHANNEL_PROVIDER_NOT_ALLOWED' })
    const providerMessageId = identifier(body.providerMessageId, 512)
    const externalConversationId = identifier(body.externalConversationId, 512)
    const externalCustomerId = identifier(body.externalCustomerId, 512)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const customer = safeCustomer(body.customer)
    const receivedAt = typeof body.receivedAt === 'string' && Number.isFinite(Date.parse(body.receivedAt)) ? new Date(body.receivedAt).toISOString() : null
    const acquisitionSource = body.acquisitionSource === undefined ? channel : identifier(body.acquisitionSource, 80)
    if (!providerMessageId || !externalConversationId || !externalCustomerId || !text || text.length > 4000 || !customer || !receivedAt
      || Date.parse(receivedAt) > Date.now() + 300000 || !acquisitionSource || !/^[A-Za-z0-9 _.-]{1,80}$/.test(acquisitionSource)) {
      return json(res, 400, { ok: false, error: 'INVALID_CHANNEL_INBOUND' })
    }
    const conversationId = channelConversationIdentity(tenantId, provider, channel, externalConversationId)
    if (body.conversationId !== conversationId) return json(res, 400, { ok: false, error: 'CONVERSATION_ID_MISMATCH' })
    const idempotencyKey = header(req.headers, 'Idempotency-Key')
    if (idempotencyKey !== idempotencyDigest({ tenantId, provider, channel, providerMessageId })) return json(res, 400, { ok: false, error: 'IDEMPOTENCY_KEY_MISMATCH' })
    const inboundId = channelInboundId(tenantId, provider, channel, providerMessageId)
    try {
      const existing = await store.get(inboundId)
      if (existing) {
        const recorded = await recordChannelInboundConversation({ tenantId, provider, channel, providerMessageId, externalConversationId, externalCustomerId, receivedAt, text, customer, acquisitionSource }, inboundId, existing.data.customerId || '', store)
        return json(res, 200, { conversationId: recorded.conversationId, customerId: recorded.customerId, duplicate: true })
      }
      const identity = await resolveIdentity({ tenantId, channel, externalCustomerId, customer, acquisitionSource, idempotencyKey, providerMessageId })
      const customerId = typeof identity?.customerId === 'string' ? identity.customerId : typeof identity?.customer?.id === 'string' ? identity.customer.id : ''
      if (!customerId) throw new ConversationError('CUSTOMER_IDENTITY_UNAVAILABLE', 503)
      const recorded = await recordChannelInboundConversation({ tenantId, provider, channel, providerMessageId, externalConversationId, externalCustomerId, receivedAt, text, customer, acquisitionSource }, inboundId, customerId, store)
      return json(res, 200, { conversationId: recorded.conversationId, customerId: recorded.customerId, duplicate: recorded.duplicate })
    } catch (error) {
      const failure = responseError(error)
      console.error(JSON.stringify({ service: 'channel-inbound', stage: 'request_failed', tenantId, code: failure.code, httpStatus: failure.status }))
      return json(res, failure.status, { ok: false, error: failure.code })
    }
  }
}
