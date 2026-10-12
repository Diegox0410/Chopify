import { createHash, timingSafeEqual } from 'node:crypto'
import { createDoc, getConversationMeta, listLiveDocuments, sendOutbound, setConversationMeta, updateDoc } from './_lib/live.js'
import { authorizePlatformOwner } from './_lib/firebaseAuth.js'
import { isKnownTenant } from '../src/config/tenantRegistry.js'

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(JSON.stringify(body))
}

const masked = value => {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length > 4 ? `**** ${digits.slice(-4)}` : 'Cliente WhatsApp'
}

const contact = item =>
  typeof item.name === 'string' && /[\p{L}\p{N}]/u.test(item.name)
    ? item.name.slice(0, 100)
    : masked(item.from)

const time = item => item.sentAt || item.createdAt || item.receivedAt || ''

const outboundText = item => {
  const parts = [item.text]
  try {
    const messages = JSON.parse(item.messagesJson || '[]')
    if (Array.isArray(messages)) for (const message of messages) {
      if (message?.type === 'text' && typeof message.text === 'string') parts.push(message.text)
      if (message?.type === 'image' && typeof message.caption === 'string') parts.push(message.caption)
    }
  } catch { /* legacy or malformed outbox rows keep their text field */ }
  return [...new Set(parts.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].join('\n')
}

export function groupLiveConversations(documents, tenantId) {
  const inbound = documents.filter(item => item.id.startsWith('in_') && item.tenantId === tenantId)
  const outByInbound = new Map()
  for (const item of documents.filter(item => item.id.startsWith('out_') && item.tenantId === tenantId)) {
    const group = outByInbound.get(item.inboundId) || []
    group.push(item)
    outByInbound.set(item.inboundId, group)
  }
  const metadata = new Map(documents.filter(item => item.id.startsWith('thread_') && item.tenantId === tenantId).map(item => [item.conversationId, item]))
  const byConversation = new Map()
  for (const item of inbound) {
    const externalId = item.externalCustomerId || item.from || item.id
    const fallbackId = createHash('sha256').update(`${tenantId}:WHATSAPP:${externalId}`).digest('hex')
    const identity = item.conversationId || `conversation_${fallbackId}`
    const group = byConversation.get(identity) || { id: identity, events: [], latestInbound: item }
    group.events.push(item)
    if (time(item) > time(group.latestInbound)) group.latestInbound = item
    byConversation.set(identity, group)
  }
  return [...byConversation.values()].map(group => {
    const events = group.events.flatMap(item => {
      const outbounds = outByInbound.get(item.id) || []
      return [
        { id: item.id, direction: 'INBOUND', senderType: 'CLIENT', text: item.text || '', createdAt: time(item), status: item.status || 'RECEIVED' },
        ...outbounds.map(outbound => ({ id: outbound.id, direction: 'OUTBOUND', senderType: outbound.senderType === 'HUMAN' || outbound.mode === 'HUMAN' ? 'HUMAN' : outbound.senderType === 'SYSTEM' || outbound.mode === 'SYSTEM' ? 'SISTEMA' : 'GANOBOT', text: outboundText(outbound), createdAt: time(outbound), status: outbound.status || 'PENDING' })),
      ]
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const latestInbound = group.latestInbound
    const thread = metadata.get(group.id)
    const outbound = group.events.flatMap(item => outByInbound.get(item.id) || []).sort((a, b) => time(a).localeCompare(time(b))).at(-1)
    const needsHuman = thread ? thread.requiresHuman === 'true' : group.events.some(item => ['NEEDS_HUMAN', 'HUMAN_QUEUED'].includes(item.status))
    const unreadCount = group.events.filter(item => time(item) > (thread?.readAt || '')).length
    return {
      id: group.id,
      tenantId,
      channel: 'WHATSAPP',
      contact: contact(latestInbound),
      lastActivityAt: events.at(-1)?.createdAt || time(latestInbound),
      messageCount: events.length,
      timeline: events,
      status: events.at(-1)?.status || latestInbound.status || 'RECEIVED',
      mode: thread?.mode || outbound?.mode || (needsHuman ? 'HUMAN' : 'GANOBOT_LIVE'),
      requiresHuman: needsHuman,
      unreadCount,
      assignedTo: thread?.assignedTo || '',
      takenBy: thread?.takenBy || '',
      readAt: thread?.readAt || '',
      escalationReason: latestInbound.escalationReason || group.events.find(item => item.escalationReason)?.escalationReason || '',
      inbound: { status: latestInbound.status || 'RECEIVED', receivedAt: latestInbound.receivedAt || '', providerMessageId: latestInbound.providerMessageId || '' },
      outbound: outbound ? {
        status: outbound.status || 'PENDING', mode: outbound.mode || '', attempts: Number(outbound.attempts || 0),
        createdAt: outbound.createdAt || '', sentAt: outbound.sentAt || '', providerMessageId: outbound.providerMessageId || '',
        error: outbound.error || '', httpStatus: outbound.httpStatus ? Number(outbound.httpStatus) : null,
        metaErrorCode: outbound.metaErrorCode ? Number(outbound.metaErrorCode) : null,
        metaErrorType: outbound.metaErrorType || '', fbtraceId: outbound.fbtraceId || '',
      } : null,
    }
  }).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
}

const operationId = (conversationId, key) => `out_human_${createHash('sha256').update(`${conversationId}:${key}`).digest('hex')}`

export async function handleConversationAction(body, access, request = {}) {
  const tenantId = resolveConversationTenant(body?.tenantId, access)
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : ''
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!tenantId || !conversationId.startsWith('conversation_')) return { status: 403, body: { error: 'Tenant or conversation not allowed' } }
  const documents = await listLiveDocuments(tenantId, 500)
  const inbound = documents.filter(item => item.id.startsWith('in_') && item.tenantId === tenantId && item.conversationId === conversationId).sort((a, b) => time(a).localeCompare(time(b)))
  if (!inbound.length) return { status: 404, body: { error: 'Conversation not found' } }
  const thread = await getConversationMeta(conversationId)
  if (thread?.tenantId && thread.tenantId !== tenantId) return { status: 403, body: { error: 'Tenant not allowed' } }
  const uid = access.uid || access.tenantId || 'operations'
  const at = new Date().toISOString()
  if (action === 'take') {
    if (thread?.mode === 'HUMAN' && thread.assignedTo && thread.assignedTo !== uid) return { status: 409, body: { error: 'Conversation is assigned to another operator' } }
    await setConversationMeta(conversationId, tenantId, { mode: 'HUMAN', requiresHuman: 'true', assignedTo: uid, takenBy: uid, takenAt: at })
    return { status: 200, body: { ok: true, mode: 'HUMAN' } }
  }
  if (action === 'release') {
    if (thread?.assignedTo && thread.assignedTo !== uid) return { status: 409, body: { error: 'Conversation is assigned to another operator' } }
    await setConversationMeta(conversationId, tenantId, { mode: 'GANOBOT_LIVE', requiresHuman: 'false', releasedBy: uid, releasedAt: at, escalationReason: '' })
    return { status: 200, body: { ok: true, mode: 'GANOBOT_LIVE' } }
  }
  if (action === 'mark-read') {
    await setConversationMeta(conversationId, tenantId, { readAt: at })
    return { status: 200, body: { ok: true, readAt: at } }
  }
  if (action === 'close') {
    await setConversationMeta(conversationId, tenantId, { mode: 'CLOSED', requiresHuman: 'false', closedAt: at, closedBy: uid })
    return { status: 200, body: { ok: true, mode: 'CLOSED' } }
  }
  if (action === 'resolve') {
    await setConversationMeta(conversationId, tenantId, { mode: 'RESOLVED', requiresHuman: 'false', resolvedAt: at, resolvedBy: uid })
    return { status: 200, body: { ok: true, mode: 'RESOLVED' } }
  }
  if (action === 'reopen') {
    await setConversationMeta(conversationId, tenantId, { mode: 'GANOBOT_LIVE', requiresHuman: 'false', reopenedAt: at, reopenedBy: uid, escalationReason: '' })
    return { status: 200, body: { ok: true, mode: 'GANOBOT_LIVE' } }
  }
  if (action === 'reply') {
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
    if (thread?.mode !== 'HUMAN') return { status: 409, body: { error: 'Take the conversation before replying' } }
    if (thread.assignedTo && thread.assignedTo !== uid) return { status: 409, body: { error: 'Conversation is assigned to another operator' } }
    if (!text || text.length > 4000 || !/^[\w:.-]{8,160}$/.test(key)) return { status: 400, body: { error: 'Invalid reply or idempotency key' } }
    const lastInbound = inbound.at(-1)
    const id = operationId(conversationId, key)
    const created = await createDoc(id, { tenantId, channel: 'WHATSAPP', provider: 'META', phoneNumberId: lastInbound.phoneNumberId, correlationId: key, inboundId: lastInbound.id, to: lastInbound.from, text, mode: 'HUMAN', senderType: 'HUMAN', sentBy: uid, status: 'PREPARED', createdAt: at, attempts: '0' })
    if (created) await updateDoc(id, { status: 'PENDING' })
    const result = await sendOutbound(id)
    return { status: result.status === 'SENT' ? 200 : 502, body: { ok: result.status === 'SENT', status: result.status } }
  }
  return { status: 400, body: { error: 'Unknown conversation action' } }
}

export const validOperationsToken = (supplied, expected) => {
  if (
    typeof supplied !== 'string' ||
    typeof expected !== 'string' ||
    !supplied ||
    !expected
  ) {
    return false
  }

  const actual = Buffer.from(supplied.replace(/^Bearer\s+/i, ''))
  const wanted = Buffer.from(expected)

  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

export const operationsAllowedTenants = () => new Set(
  (process.env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS || 'tenant-floes')
    .split(',')
    .map(value => value.trim())
    .filter(isKnownTenant),
)

export const resolveConversationTenant = (requested, access) => {
  const tenantId = typeof requested === 'string' ? requested.trim() : ''
  if (!tenantId) return null
  if (access.type === 'tenant-owner' && access.tenantId !== tenantId) return null
  if (access.type === 'operations' && !operationsAllowedTenants().has(tenantId)) return null
  return isKnownTenant(tenantId) ? tenantId : null
}

const ownerTokens = () => ({
  'tenant-floes': process.env.CHOPIFY_OWNER_API_TOKEN_FLOES,
  'tenant-mg': process.env.CHOPIFY_OWNER_API_TOKEN_MG,
  'tenant-dgng': process.env.CHOPIFY_OWNER_API_TOKEN_DGNG,
})

async function authorize(req) {
  const authorization = req.headers?.authorization

  if (
    validOperationsToken(
      authorization,
      process.env.CHOPIFY_OPERATIONS_API_TOKEN,
    )
  ) {
    return { type: 'operations' }
  }

  for (const [tenantId, token] of Object.entries(ownerTokens())) if (validOperationsToken(authorization, token)) return { type: 'tenant-owner', tenantId }

  const platformOwner = await authorizePlatformOwner(req)

  if (platformOwner.ok) {
    return {
      type: 'platform-owner',
      uid: platformOwner.identity.uid,
    }
  }

  return { type: 'denied', status: platformOwner.status }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    if (req.method === 'POST') {
      const access = await authorize(req)
      if (access.type === 'denied') return json(res, access.status, { error: 'Unauthorized' })
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      const result = await handleConversationAction(body, access, req)
      return json(res, result.status, result.body)
    }
    const requestedQuery = typeof req.query?.tenantId === 'string' ? req.query.tenantId : ''
    const access = await authorize(req)

    if (access.type === 'denied') {
      return json(res, access.status, { error: access.status === 403 ? 'Forbidden' : access.status === 503 ? 'Authentication service not configured' : 'Unauthorized' })
    }

    const requested = resolveConversationTenant(requestedQuery, access)
    if (!requested) {
      return json(res, 403, { error: 'Tenant not allowed' })
    }

    const documents = await listLiveDocuments(requested, 300)

    return json(res, 200, groupLiveConversations(documents, requested))
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'whatsapp-live',
        stage: 'conversation_read_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    )

    return json(res, 503, {
      error: 'No fue posible cargar conversaciones reales',
    })
  }
}
