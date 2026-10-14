import { timingSafeEqual } from 'node:crypto'
import { authorizePlatformOwner } from './_lib/firebaseAuth.js'
import { authorizeOwnerService } from './_lib/ownerServiceAuth.js'
import { isKnownTenant } from '../src/config/tenantRegistry.js'
import { changeConversationControl, ConversationError, readConversation, recordInboundConversation } from './_lib/conversationStore.js'
import { listConversationSummaries, readConversationThread, readCustomerConversationContext } from './_lib/conversationReadModel.js'
import { queryLiveDocuments } from './_lib/live.js'
import { sendHumanReply } from './_lib/conversationHumanReply.js'

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(JSON.stringify(body))
}
export const validOperationsToken = (supplied, expected) => {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || !/^Bearer [^\s]+$/i.test(supplied) || !expected) return false
  const actual = Buffer.from(supplied.slice(7)); const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}
export const operationsAllowedTenants = () => new Set((process.env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS || 'tenant-floes').split(',').map(value => value.trim()).filter(isKnownTenant))
export const resolveConversationTenant = (requested, access) => {
  const tenantId = typeof requested === 'string' ? requested.trim() : ''
  if (!tenantId || (access.type === 'tenant-owner' && access.tenantId !== tenantId) || (access.type === 'operations' && !operationsAllowedTenants().has(tenantId))) return null
  return isKnownTenant(tenantId) ? tenantId : null
}
export async function authorizeConversations(req) {
  const owner = authorizeOwnerService(req)
  if (owner) return owner.ok ? { type: 'tenant-owner', tenantId: owner.tenantId, uid: owner.identity.uid } : { type: 'denied', status: owner.status }
  if (validOperationsToken(req.headers?.authorization, process.env.CHOPIFY_OPERATIONS_API_TOKEN)) return { type: 'operations', uid: 'chopify-operations' }
  const platform = await authorizePlatformOwner(req)
  return platform.ok ? { type: 'platform-owner', uid: platform.identity.uid } : { type: 'denied', status: platform.status }
}
const commerceContext = async input => (await import('./_lib/conversationCommerce.js')).readConversationCommerceContext(input)
const parseBody = body => typeof body === 'string' ? JSON.parse(body) : body || {}
export function createConversationHandler(dependencies = {}) {
  return async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
    try {
      const access = await (dependencies.authorize || authorizeConversations)(req)
      if (access.type === 'denied') return json(res, access.status, { ok: false, error: access.status === 403 ? 'FORBIDDEN' : access.status === 503 ? 'AUTHENTICATION_NOT_CONFIGURED' : 'UNAUTHORIZED' })
      const body = req.method === 'POST' ? parseBody(req.body) : req.query || {}
      const tenantId = resolveConversationTenant(body.tenantId, access)
      if (!tenantId) return json(res, 403, { ok: false, error: 'TENANT_NOT_ALLOWED' })
      const overrides = { ...dependencies.store, commerceContext: dependencies.commerceContext || commerceContext }
      if (req.method === 'GET') {
        const view = body.view || 'list'
        if (view === 'list') return json(res, 200, await listConversationSummaries(tenantId, body, overrides))
        if (view === 'thread') {
          if (!/^conversation_[a-f0-9]{64}$/.test(body.conversationId || '')) throw new ConversationError('INVALID_CONVERSATION', 400)
          return json(res, 200, await readConversationThread(tenantId, body.conversationId, body, overrides))
        }
        if (view === 'customer') {
          if (typeof body.customerId !== 'string' || !/^[\w:.-]{1,128}$/.test(body.customerId)) throw new ConversationError('INVALID_CUSTOMER', 400)
          return json(res, 200, await readCustomerConversationContext(tenantId, body.customerId, body, overrides))
        }
        throw new ConversationError('UNKNOWN_CONVERSATION_VIEW', 400)
      }
      const conversationId = body.conversationId
      if (!/^conversation_[a-f0-9]{64}$/.test(conversationId || '')) throw new ConversationError('INVALID_CONVERSATION', 400)
      if (!['take', 'release', 'mark-read', 'close', 'reopen', 'send-human'].includes(body.action) || !/^[\w:.-]{8,160}$/.test(body.idempotencyKey || '')) throw new ConversationError('INVALID_CONVERSATION_ACTION', 400)
      if (body.action === 'close' && !String(body.reason || '').trim()) throw new ConversationError('CLOSE_REASON_REQUIRED', 400)
      if (!await readConversation(tenantId, conversationId, overrides)) {
        const rows = await (overrides.query || queryLiveDocuments)(tenantId, { filters: [{ field: 'conversationId', value: conversationId }], orderBy: 'receivedAt', limit: 1 })
        const inbound = rows.find(item => item.tenantId === tenantId && item.id.startsWith('in_'))
        if (!inbound) throw new ConversationError('CONVERSATION_NOT_FOUND', 404)
        await recordInboundConversation({ ...inbound, tenantId, from: inbound.from, receivedAt: inbound.receivedAt, name: inbound.name }, inbound.id, overrides)
      }
      const result = body.action === 'send-human'
        ? await sendHumanReply(tenantId, conversationId, access.uid, body, { ...overrides, ...dependencies.humanReply })
        : await changeConversationControl(tenantId, conversationId, body.action, access.uid, body, overrides)
      return json(res, 200, result)
    } catch (error) {
      const status = error instanceof ConversationError ? error.status : error instanceof SyntaxError ? 400 : 503
      const code = error instanceof ConversationError ? error.code : error instanceof SyntaxError ? 'INVALID_JSON' : 'CONVERSATION_SERVICE_UNAVAILABLE'
      console.error(JSON.stringify({ service: 'conversations', stage: 'request_failed', code, httpStatus: status }))
      return json(res, status, { ok: false, error: code })
    }
  }
}
export default createConversationHandler()
