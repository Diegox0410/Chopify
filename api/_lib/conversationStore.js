import { createHash, randomUUID } from 'node:crypto'
import { commitLiveRecords, getLiveRecord, queryLiveDocuments } from './live.js'
import { isKnownTenant } from '../../src/config/tenantRegistry.js'

const hash = value => createHash('sha256').update(value).digest('hex')
export const conversationIdentity = (tenantId, channel, externalId) => `conversation_${hash(`${tenantId}:META:${channel}:${externalId}`)}`
export const channelConversationIdentity = (tenantId, provider, channel, externalConversationId) => `conversation_${hash(JSON.stringify([tenantId, provider, channel, externalConversationId]))}`
export const channelInboundId = (tenantId, provider, channel, providerMessageId) => `in_${hash(`${tenantId}:${provider}:${channel}:${providerMessageId}`)}`
export const conversationMetaId = conversationId => `thread_${hash(conversationId)}`
const storage = overrides => ({ get: getLiveRecord, commit: commitLiveRecords, query: queryLiveDocuments, ...overrides })
const clock = () => new Date().toISOString()
const scoped = (tenantId, row) => {
  if (!isKnownTenant(tenantId) || row?.tenantId !== tenantId) throw new ConversationError('TENANT_NOT_ALLOWED', 403)
  return row
}
export class ConversationError extends Error {
  constructor(code, status = 409) { super(code); this.name = 'ConversationError'; this.code = code; this.status = status }
}
export async function readConversation(tenantId, conversationId, overrides = {}) {
  const record = await storage(overrides).get(conversationMetaId(conversationId))
  return record ? scoped(tenantId, record.data) : null
}
export async function updateConversation(tenantId, conversationId, transform, overrides = {}) {
  if (!isKnownTenant(tenantId) || !/^conversation_[a-f0-9]{64}$/.test(conversationId)) throw new ConversationError('INVALID_CONVERSATION', 400)
  const store = storage(overrides)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await store.get(conversationMetaId(conversationId))
    const current = record ? scoped(tenantId, record.data) : null
    const next = transform(current)
    if (next === null) return current
    const data = { ...(current || {}), ...next, kind: 'THREAD', tenantId, conversationId, updatedAt: clock() }
    if (await store.commit([{ id: conversationMetaId(conversationId), data, version: record?.version }])) return data
  }
  throw new ConversationError('CONVERSATION_CHANGED_CONCURRENTLY')
}
export async function recordInboundConversation(message, inboundId, overrides = {}) {
  const conversationId = conversationIdentity(message.tenantId, 'WHATSAPP', message.from)
  return updateConversation(message.tenantId, conversationId, current => ({
    ...(current ? {} : { createdAt: message.receivedAt, mode: 'GANOBOT_LIVE', status: 'AI_ATTENDING', unreadCount: '0' }),
    channel: 'WHATSAPP', provider: 'META', externalCustomerId: message.from,
    contact: message.name || current?.contact || `**** ${String(message.from).slice(-4)}`,
    lastActivityAt: message.receivedAt, lastInboundAt: message.customerMessageAt ?? message.receivedAt,
    lastInboundId: inboundId, phoneNumberId: message.phoneNumberId, lastText: message.text,
    unreadCount: String(Number(current?.unreadCount || 0) + 1),
    // A closed thread requires explicit reopening; a new inbound stays queued.
  }), overrides)
}
export async function recordChannelInboundConversation(message, inboundId, customerId, overrides = {}) {
  const { tenantId, provider, channel, externalConversationId, externalCustomerId, providerMessageId, receivedAt, text } = message
  if (!isKnownTenant(tenantId) || !['WEB', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK'].includes(channel)
    || !['META', 'WEB', 'TIKTOK'].includes(provider)) throw new ConversationError('INVALID_CHANNEL_INBOUND', 400)
  const conversationId = channelConversationIdentity(tenantId, provider, channel, externalConversationId)
  if (inboundId !== channelInboundId(tenantId, provider, channel, providerMessageId)) throw new ConversationError('INVALID_INBOUND_ID', 400)
  const payloadHash = hash(JSON.stringify({ tenantId, provider, channel, providerMessageId, externalConversationId, externalCustomerId, text }))
  const store = storage(overrides)
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existingMessage = await store.get(inboundId)
    if (existingMessage) {
      const row = scoped(tenantId, existingMessage.data)
      if (row.conversationId !== conversationId || row.payloadHash !== payloadHash || row.providerMessageId !== providerMessageId) {
        throw new ConversationError('IDEMPOTENCY_CONFLICT', 409)
      }
      return { conversationId, customerId: row.customerId || customerId, inboundId, duplicate: true }
    }
    const metaId = conversationMetaId(conversationId)
    const threadRecord = await store.get(metaId)
    const current = threadRecord ? scoped(tenantId, threadRecord.data) : null
    if (current?.customerId && current.customerId !== customerId) throw new ConversationError('CUSTOMER_CONTEXT_CONFLICT', 409)
    const lastActivityAt = current?.lastActivityAt && timestamp(current.lastActivityAt) > timestamp(receivedAt) ? current.lastActivityAt : receivedAt
    const inbound = {
      kind: 'INBOUND', tenantId, provider, channel, providerMessageId, externalConversationId, externalCustomerId,
      customerId, conversationId, text, receivedAt, payloadHash, status: 'RECEIVED',
    }
    const unreadCount = String(Number(current?.unreadCount || 0) + 1)
    const thread = {
      ...(current || { createdAt: receivedAt, mode: 'GANOBOT_LIVE', status: 'AI_ATTENDING', unreadCount: '0' }),
      kind: 'THREAD', tenantId, conversationId, customerId, channel, provider, externalConversationId, externalCustomerId,
      contact: message.customer?.name || current?.contact || 'Cliente de canal',
      origin: current?.origin || message.acquisitionSource || channel,
      lastActivityAt, lastInboundAt: receivedAt, lastInboundId: inboundId, lastText: text, unreadCount,
    }
    if (await store.commit([
      { id: inboundId, data: inbound },
      { id: metaId, data: thread, version: threadRecord?.version },
    ])) return { conversationId, customerId, inboundId, duplicate: false }
  }
  throw new ConversationError('CONVERSATION_CHANGED_CONCURRENTLY')
}
export async function recordChannelOutboundMessage(message, overrides = {}) {
  const { tenantId, provider, channel, conversationId, customerId, messageId, correlationId, text, createdAt } = message
  if (!isKnownTenant(tenantId) || !['WEB', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK'].includes(channel)
    || !['META', 'WEB', 'TIKTOK'].includes(provider) || !/^conversation_[a-f0-9]{64}$/.test(conversationId || '')) {
    throw new ConversationError('INVALID_CHANNEL_OUTBOUND', 400)
  }
  const outboundId = `out_${hash(`${tenantId}:${conversationId}:${customerId}:${channel}:${correlationId}`)}`
  const outboxId = `channel_outbox_${hash(`${tenantId}:${conversationId}:${customerId}:${channel}:${correlationId}`)}`
  const payloadHash = hash(JSON.stringify({ tenantId, provider, channel, conversationId, customerId, messageId, correlationId, text }))
  const store = storage(overrides)
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existingMessage = await store.get(outboundId)
    if (existingMessage) {
      const row = scoped(tenantId, existingMessage.data)
      if (row.payloadHash !== payloadHash || row.conversationId !== conversationId || row.customerId !== customerId) throw new ConversationError('IDEMPOTENCY_CONFLICT', 409)
      const existingOutbox = await store.get(outboxId)
      if (!existingOutbox) throw new ConversationError('OUTBOX_RECORD_MISSING')
      const queued = scoped(tenantId, existingOutbox.data)
      if (queued.outboundId !== outboundId || queued.payloadHash !== payloadHash || queued.conversationId !== conversationId
        || queued.customerId !== customerId || !['NOT_SENT', 'CLAIMED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN', 'BLOCKED'].includes(queued.status)) throw new ConversationError('IDEMPOTENCY_CONFLICT', 409)
      return { conversationId, customerId, messageId: row.messageId, outboundId, outboxId, status: queued.status, duplicate: true }
    }
    const metaId = conversationMetaId(conversationId)
    const threadRecord = await store.get(metaId)
    if (!threadRecord) throw new ConversationError('CONVERSATION_NOT_FOUND', 404)
    const current = scoped(tenantId, threadRecord.data)
    if (current.customerId !== customerId || current.channel !== channel || current.provider !== provider) throw new ConversationError('CONVERSATION_CONTEXT_MISMATCH', 409)
    if (current.mode !== 'GANOBOT_LIVE' || current.requiresHuman === 'true') throw new ConversationError('AUTOMATION_BLOCKED_BY_HANDOFF', 409)
    const lastActivityAt = current.lastActivityAt && timestamp(current.lastActivityAt) > timestamp(createdAt) ? current.lastActivityAt : createdAt
    const outbound = {
      kind: 'OUTBOUND', tenantId, provider, channel, conversationId, customerId, messageId, correlationId,
      senderType: 'GANOBOT', externalCustomerId: current.externalCustomerId || '',
      lastInboundAt: current.lastInboundAt || '', text, createdAt, status: 'RECORDED', deliveryStatus: 'NOT_SENT', payloadHash,
    }
    const outbox = {
      kind: 'CHANNEL_OUTBOX', tenantId, provider, channel, conversationId, customerId, messageId, correlationId,
      outboundId, externalCustomerId: current.externalCustomerId || '', lastInboundAt: current.lastInboundAt || '',
      text, createdAt, status: 'NOT_SENT', attempts: '0', payloadHash,
    }
    const thread = { ...current, lastActivityAt, lastOutboundAt: createdAt, lastOutboundId: outboundId, lastText: text,
      ...(current.mode === 'GANOBOT_LIVE' ? { status: 'WAITING_CUSTOMER' } : {}) }
    if (await store.commit([
      { id: outboundId, data: outbound },
      { id: outboxId, data: outbox },
      { id: metaId, data: thread, version: threadRecord.version },
    ])) return { conversationId, customerId, messageId, outboundId, outboxId, status: outbox.status, duplicate: false }
  }
  throw new ConversationError('CONVERSATION_CHANGED_CONCURRENTLY')
}

const OUTBOX_TERMINAL = new Set(['SENT', 'FAILED', 'UNKNOWN', 'BLOCKED'])
const outboxNow = () => new Date().toISOString()

/** List tenant-scoped work that is safe to claim. SENDING records are never retried automatically. */
export async function listChannelOutbox(tenantId, { limit = 50, now = outboxNow() } = {}, overrides = {}) {
  if (!isKnownTenant(tenantId)) throw new ConversationError('TENANT_NOT_ALLOWED', 403)
  const store = storage(overrides)
  const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100)
  const [newItems, claimedItems] = await Promise.all(['NOT_SENT', 'CLAIMED'].map(status => store.query(tenantId, {
    filters: [{ field: 'kind', value: 'CHANNEL_OUTBOX' }, { field: 'status', value: status }],
    orderBy: 'createdAt', direction: 'ASCENDING', limit: boundedLimit,
  })))
  const eligible = [...newItems, ...claimedItems.filter(item => item.leaseUntil && item.leaseUntil <= now)]
    .filter(item => item.tenantId === tenantId && item.kind === 'CHANNEL_OUTBOX')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id))
  return eligible.slice(0, boundedLimit)
}

async function transitionChannelOutbox(tenantId, outboxId, claimId, nextStatus, patch = {}, overrides = {}) {
  const store = storage(overrides)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await store.get(outboxId)
    if (!record) throw new ConversationError('OUTBOX_NOT_FOUND', 404)
    const current = scoped(tenantId, record.data)
    if (current.kind !== 'CHANNEL_OUTBOX') throw new ConversationError('INVALID_OUTBOX_RECORD')
    if (OUTBOX_TERMINAL.has(current.status)) return current
    if (current.claimId !== claimId) throw new ConversationError('OUTBOX_LEASE_LOST')
    const outboundRecord = await store.get(current.outboundId)
    if (!outboundRecord) throw new ConversationError('OUTBOUND_RECORD_MISSING')
    const outbound = scoped(tenantId, outboundRecord.data)
    if (outbound.kind !== 'OUTBOUND' || outbound.conversationId !== current.conversationId || outbound.payloadHash !== current.payloadHash) throw new ConversationError('OUTBOUND_CONTEXT_MISMATCH')
    const at = outboxNow()
    const next = { ...current, ...patch, status: nextStatus, updatedAt: at,
      ...(OUTBOX_TERMINAL.has(nextStatus) ? { finishedAt: at, leaseOwner: '', leaseUntil: '' } : {}) }
    const delivered = nextStatus === 'SENT' ? 'ACCEPTED' : nextStatus
    const nextOutbound = { ...outbound, deliveryStatus: delivered, deliveryStatusAt: at,
      ...(typeof patch.failureCode === 'string' ? { deliveryFailureCode: patch.failureCode } : {}),
      ...(typeof patch.providerMessageId === 'string' ? { providerMessageId: patch.providerMessageId } : {}) }
    const writes = [
      { id: outboxId, data: next, version: record.version },
      { id: current.outboundId, data: nextOutbound, version: outboundRecord.version },
    ]
    if (OUTBOX_TERMINAL.has(nextStatus)) {
      const metaId = conversationMetaId(current.conversationId)
      const meta = await store.get(metaId)
      if (meta && meta.data.sendLeaseId === claimId) {
        scoped(tenantId, meta.data)
        writes.push({ id: metaId, data: { ...meta.data, sendLeaseId: '', sendLeaseUntil: '', updatedAt: at }, version: meta.version })
      }
    }
    if (await store.commit(writes)) return next
  }
  throw new ConversationError('OUTBOX_CHANGED_CONCURRENTLY')
}

/** A version-preconditioned claim lets only one worker own this item at a time. */
export async function claimChannelOutbox(tenantId, outboxId, workerId, { leaseMs = 30000, now = Date.now() } = {}, overrides = {}) {
  if (!isKnownTenant(tenantId) || typeof workerId !== 'string' || !/^[\w:.-]{1,128}$/.test(workerId)) throw new ConversationError('INVALID_OUTBOX_CLAIM', 400)
  const store = storage(overrides)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await store.get(outboxId)
    if (!record) throw new ConversationError('OUTBOX_NOT_FOUND', 404)
    const current = scoped(tenantId, record.data)
    if (current.kind !== 'CHANNEL_OUTBOX') throw new ConversationError('INVALID_OUTBOX_RECORD')
    const expiredClaim = current.status === 'CLAIMED' && Date.parse(current.leaseUntil || '') <= now
    if (current.status !== 'NOT_SENT' && !expiredClaim) return null
    const claimId = randomUUID()
    const claimedAt = new Date(now).toISOString()
    const next = { ...current, status: 'CLAIMED', claimId, leaseOwner: workerId,
      leaseUntil: new Date(now + Math.min(Math.max(leaseMs, 1000), 120000)).toISOString(), claimedAt,
      attempts: String(Number(current.attempts || 0) + 1), updatedAt: claimedAt }
    if (await store.commit([{ id: outboxId, data: next, version: record.version }])) return { ...next, id: outboxId }
  }
  return null
}

export async function markChannelOutboxSending(tenantId, outboxId, claimId, overrides = {}) {
  const store = storage(overrides)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await store.get(outboxId)
    if (!record) throw new ConversationError('OUTBOX_NOT_FOUND', 404)
    const current = scoped(tenantId, record.data)
    if (current.status !== 'CLAIMED' || current.claimId !== claimId || Date.parse(current.leaseUntil || '') <= Date.now()) throw new ConversationError('OUTBOX_LEASE_LOST')
    const metaId = conversationMetaId(current.conversationId)
    const meta = await store.get(metaId)
    if (!meta) return transitionChannelOutbox(tenantId, outboxId, claimId, 'BLOCKED', { failureCode: 'CONVERSATION_NOT_FOUND' }, overrides)
    const thread = scoped(tenantId, meta.data)
    if (thread.customerId !== current.customerId || thread.channel !== current.channel || thread.provider !== current.provider) throw new ConversationError('CONVERSATION_CONTEXT_MISMATCH')
    if (thread.mode !== 'GANOBOT_LIVE' || thread.requiresHuman === 'true') return transitionChannelOutbox(tenantId, outboxId, claimId, 'BLOCKED', { failureCode: 'AUTOMATION_BLOCKED_BY_HANDOFF' }, overrides)
    if (thread.sendLeaseUntil > outboxNow()) throw new ConversationError('OUTBOUND_IN_PROGRESS')
    const outboundRecord = await store.get(current.outboundId)
    if (!outboundRecord) throw new ConversationError('OUTBOUND_RECORD_MISSING')
    const outbound = scoped(tenantId, outboundRecord.data)
    const at = outboxNow()
    const next = { ...current, status: 'SENDING', sendingAt: at, updatedAt: at,
      leaseUntil: new Date(Date.now() + 60000).toISOString() }
    const nextOutbound = { ...outbound, deliveryStatus: 'SENDING', deliveryStatusAt: at }
    const nextThread = { ...thread, sendLeaseId: claimId, sendLeaseUntil: new Date(Date.now() + 60000).toISOString(), updatedAt: at }
    if (await store.commit([
      { id: outboxId, data: next, version: record.version },
      { id: current.outboundId, data: nextOutbound, version: outboundRecord.version },
      { id: metaId, data: nextThread, version: meta.version },
    ])) return next
  }
  throw new ConversationError('OUTBOX_CHANGED_CONCURRENTLY')
}

export async function finishChannelOutbox(tenantId, outboxId, claimId, result, overrides = {}) {
  if (!result || !['SENT', 'FAILED', 'UNKNOWN', 'BLOCKED'].includes(result.status)) throw new ConversationError('INVALID_OUTBOX_RESULT', 400)
  return transitionChannelOutbox(tenantId, outboxId, claimId, result.status, {
    ...(typeof result.providerMessageId === 'string' ? { providerMessageId: result.providerMessageId.slice(0, 512) } : {}),
    ...(typeof result.code === 'string' ? { failureCode: result.code.slice(0, 100) } : {}),
  }, overrides)
}

/** Reconcile stale SENDING work to UNKNOWN; retrying it could duplicate a provider-accepted reply. */
export async function reconcileChannelOutbox(tenantId, { now = outboxNow(), limit = 100 } = {}, overrides = {}) {
  const store = storage(overrides)
  const stale = await store.query(tenantId, { filters: [{ field: 'kind', value: 'CHANNEL_OUTBOX' }, { field: 'status', value: 'SENDING' }], orderBy: 'sendingAt', direction: 'ASCENDING', limit: Math.min(Math.max(Number(limit) || 100, 1), 100) })
  const completed = []
  for (const row of stale.filter(item => item.tenantId === tenantId && Date.parse(item.leaseUntil || '') <= Date.parse(now))) {
    try { completed.push(await transitionChannelOutbox(tenantId, row.id, row.claimId, 'UNKNOWN', { failureCode: 'WORKER_LOST_DURING_SEND' }, overrides)) }
    catch (error) { if (!(error instanceof ConversationError) || error.code !== 'OUTBOX_LEASE_LOST') throw error }
  }
  return completed
}

/** One bounded worker pass. Transport is injected; this module never contacts a provider itself. */
export async function dispatchChannelOutboxOnce({ tenantId, workerId, transport, limit = 20, store: overrides, now = Date.now() }) {
  if (typeof transport !== 'function') throw new ConversationError('CHANNEL_TRANSPORT_REQUIRED', 400)
  await reconcileChannelOutbox(tenantId, { now: new Date(now).toISOString(), limit }, overrides)
  const pending = await listChannelOutbox(tenantId, { limit, now: new Date(now).toISOString() }, overrides)
  const outcomes = []
  for (const item of pending) {
    const claim = await claimChannelOutbox(tenantId, item.id, workerId, { now }, overrides)
    if (!claim) continue
    let sending
    try { sending = await markChannelOutboxSending(tenantId, item.id, claim.claimId, overrides) }
    catch (error) {
      if (error instanceof ConversationError && error.code === 'CONVERSATION_CONTEXT_MISMATCH') {
        await finishChannelOutbox(tenantId, item.id, claim.claimId, { status: 'FAILED', code: error.code }, overrides)
        outcomes.push({ id: item.id, status: 'FAILED', code: error.code }); continue
      }
      if (error instanceof ConversationError && error.code === 'OUTBOUND_IN_PROGRESS') {
        outcomes.push({ id: item.id, status: 'CLAIMED', code: error.code }); continue
      }
      throw error
    }
    if (sending.status !== 'SENDING') { outcomes.push({ id: item.id, status: sending.status }); continue }
    try {
      const result = await transport({ tenantId, provider: item.provider, channel: item.channel, conversationId: item.conversationId,
        customerId: item.customerId, externalCustomerId: item.externalCustomerId || '', lastInboundAt: item.lastInboundAt || '',
        text: item.text, idempotencyKey: item.id, outboxId: item.id })
      const finished = await finishChannelOutbox(tenantId, item.id, claim.claimId, result, overrides)
      outcomes.push({ id: item.id, status: finished.status })
    } catch (error) {
      const finished = await finishChannelOutbox(tenantId, item.id, claim.claimId,
        { status: 'UNKNOWN', code: error instanceof Error ? error.name : 'TRANSPORT_ERROR' }, overrides)
      outcomes.push({ id: item.id, status: finished.status })
    }
  }
  return outcomes
}
export async function requireConversationHuman(tenantId, conversationId, inboundId, reason, technicalReason = '', overrides = {}) {
  const store = storage(overrides)
  const eventId = `event_handoff_${hash(`${tenantId}:${conversationId}:${inboundId}`)}`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previous = await store.get(eventId)
    if (previous) return
    const record = await store.get(conversationMetaId(conversationId))
    if (!record) throw new ConversationError('CONVERSATION_NOT_FOUND', 404)
    const current = scoped(tenantId, record.data); const at = clock()
    const data = { ...current, mode: 'HUMAN', status: current.assignedTo ? 'HUMAN_ATTENDING' : 'REQUIRES_HUMAN', requiresHuman: 'true', escalationReason: reason, technicalReason, updatedAt: at }
    const event = { kind: 'EVENT', tenantId, conversationId, action: 'REQUIRES_HUMAN', actor: 'GANOBOT', createdAt: at, reason, technicalReason, text: 'Requiere atención humana' }
    if (await store.commit([{ id: record.id, data, version: record.version }, { id: eventId, data: event }])) return
  }
  throw new ConversationError('CONVERSATION_CHANGED_CONCURRENTLY')
}
export async function changeConversationControl(tenantId, conversationId, action, actor, input = {}, overrides = {}) {
  if (!/^[\w:.-]{8,160}$/.test(input.idempotencyKey || '')) throw new ConversationError('IDEMPOTENCY_KEY_REQUIRED', 400)
  if (!['take', 'release', 'mark-read', 'close', 'reopen'].includes(action)) throw new ConversationError('UNKNOWN_CONVERSATION_ACTION', 400)
  const store = storage(overrides)
  const eventId = `event_${hash(`${tenantId}:${conversationId}:${actor}:${input.idempotencyKey}`)}`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previous = await store.get(eventId)
    if (previous) {
      scoped(tenantId, previous.data)
      if (previous.data.action !== action || previous.data.reason !== (input.reason || '')) throw new ConversationError('IDEMPOTENCY_CONFLICT')
      return JSON.parse(previous.data.resultJson)
    }
    const record = await store.get(conversationMetaId(conversationId))
    if (!record) throw new ConversationError('CONVERSATION_NOT_FOUND', 404)
    const current = scoped(tenantId, record.data)
    const at = clock()
    if (current.sendLeaseUntil > at && action !== 'mark-read') throw new ConversationError('OUTBOUND_IN_PROGRESS')
    if (current.assignedTo && current.assignedTo !== actor && action !== 'mark-read') throw new ConversationError('ASSIGNED_TO_ANOTHER_OPERATOR')
    const reason = String(input.reason || '').trim().slice(0, 500)
    if (action === 'close' && !reason) throw new ConversationError('CLOSE_REASON_REQUIRED', 400)
    const patches = {
      take: { mode: 'HUMAN', status: 'HUMAN_ATTENDING', requiresHuman: 'true', assignedTo: actor, takenBy: actor, takenAt: at },
      release: { mode: 'GANOBOT_LIVE', status: 'AI_ATTENDING', requiresHuman: 'false', assignedTo: '', releasedBy: actor, releasedAt: at, escalationReason: '' },
      'mark-read': { readAt: at, unreadCount: '0' },
      close: { mode: 'CLOSED', status: 'CLOSED', requiresHuman: 'false', closedAt: at, closedBy: actor, closeReason: reason },
      reopen: { mode: 'GANOBOT_LIVE', status: 'AI_ATTENDING', requiresHuman: 'false', assignedTo: '', closedAt: '', closeReason: '', reopenedAt: at, reopenedBy: actor },
    }
    const next = { ...current, ...patches[action], updatedAt: at }
    const result = { ok: true, conversationId, mode: next.mode, status: next.status, correlationId: eventId }
    const event = { kind: 'EVENT', tenantId, conversationId, action, actor, reason: input.reason || '', createdAt: at, text: action, resultJson: JSON.stringify(result) }
    if (await store.commit([{ id: record.id, data: next, version: record.version }, { id: eventId, data: event }])) return result
  }
  throw new ConversationError('CONVERSATION_CHANGED_CONCURRENTLY')
}
export async function claimConversationSend(tenantId, conversationId, senderType, claimId = randomUUID(), overrides = {}) {
  const at = clock()
  const thread = await updateConversation(tenantId, conversationId, current => {
    if (!current) throw new ConversationError('CONVERSATION_NOT_FOUND', 404)
    if (current.sendLeaseUntil > at) throw new ConversationError('OUTBOUND_IN_PROGRESS')
    if (senderType === 'GANOBOT' && (current.mode !== 'GANOBOT_LIVE' || current.requiresHuman === 'true')) throw new ConversationError('AUTOMATION_BLOCKED_BY_HANDOFF')
    if (senderType === 'HUMAN' && current.mode !== 'HUMAN') throw new ConversationError('HUMAN_CONTROL_REQUIRED')
    if (senderType === 'HUMAN' && (!overrides.senderActor || current.assignedTo && current.assignedTo !== overrides.senderActor)) throw new ConversationError('ASSIGNED_TO_ANOTHER_OPERATOR')
    return { sendLeaseId: claimId, sendLeaseUntil: new Date(Date.now() + 60000).toISOString() }
  }, overrides)
  return { claimId: thread.sendLeaseId }
}
export async function renewConversationSend(tenantId, conversationId, claimId, senderType, overrides = {}) {
  return updateConversation(tenantId, conversationId, current => {
    if (!current || current.sendLeaseId !== claimId) throw new ConversationError('OUTBOUND_LEASE_LOST')
    if (senderType === 'GANOBOT' && (current.mode !== 'GANOBOT_LIVE' || current.requiresHuman === 'true')) throw new ConversationError('AUTOMATION_BLOCKED_BY_HANDOFF')
    if (senderType === 'HUMAN' && (current.mode !== 'HUMAN' || current.assignedTo && current.assignedTo !== overrides.senderActor)) throw new ConversationError('ASSIGNED_TO_ANOTHER_OPERATOR')
    return { sendLeaseUntil: new Date(Date.now() + 60000).toISOString() }
  }, overrides)
}
export async function releaseConversationSend(tenantId, conversationId, claimId, fields = {}, overrides = {}) {
  return updateConversation(tenantId, conversationId, current => current?.sendLeaseId === claimId
    ? { ...fields, sendLeaseId: '', sendLeaseUntil: '' } : null, overrides)
}
export async function getConversationDeliveryContext({ tenantId, conversationId }, overrides = {}) {
  const store = storage(overrides)
  const thread = await readConversation(tenantId, conversationId, overrides)
  if (thread?.externalCustomerId && thread.lastInboundAt) return {
    tenantId, conversationId, channel: thread.channel, recipient: thread.externalCustomerId,
    phoneNumberId: thread.phoneNumberId, lastCustomerMessageAt: thread.lastInboundAt,
  }
  // Legacy threads have no metadata. A bounded exact thread query recovers the
  // real persisted sender, never a customer name or unrelated recent message.
  const rows = await store.query(tenantId, { filters: [{ field: 'conversationId', value: conversationId }], orderBy: 'receivedAt', limit: 1 })
  const inbound = rows.find(item => item.id.startsWith('in_') && item.tenantId === tenantId)
  if (!inbound) return null
  return { tenantId, conversationId, channel: inbound.channel || 'WHATSAPP', recipient: inbound.from,
    phoneNumberId: inbound.phoneNumberId, lastCustomerMessageAt: inbound.receivedAt }
}
