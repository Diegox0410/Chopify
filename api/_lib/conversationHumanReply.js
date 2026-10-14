import { createHash } from 'node:crypto'
import { createDoc, getLiveRecord, sendOutbound, updateDoc } from './live.js'
import { ConversationError, getConversationDeliveryContext, readConversation } from './conversationStore.js'

export async function sendHumanReply(tenantId, conversationId, actor, input, overrides = {}) {
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!text || text.length > 4000 || !/^[\w:.-]{8,160}$/.test(input.idempotencyKey || '')) throw new ConversationError('INVALID_HUMAN_MESSAGE', 400)
  const thread = await readConversation(tenantId, conversationId, overrides)
  if (!thread || thread.mode !== 'HUMAN') throw new ConversationError('HUMAN_CONTROL_REQUIRED')
  if (thread.assignedTo && thread.assignedTo !== actor) throw new ConversationError('ASSIGNED_TO_ANOTHER_OPERATOR')
  const context = await getConversationDeliveryContext({ tenantId, conversationId }, overrides)
  if (!context || context.channel !== 'WHATSAPP') throw new ConversationError('CHANNEL_NOT_AVAILABLE')
  const age = Date.now() - Date.parse(context.lastCustomerMessageAt)
  if (!Number.isFinite(age) || age < -300000 || age >= 86400000) throw new ConversationError('OUTSIDE_CUSTOMER_WINDOW')
  const id = `out_human_${createHash('sha256').update(`${tenantId}:${conversationId}:${actor}:${input.idempotencyKey}`).digest('hex')}`
  const previous = await (overrides.get || getLiveRecord)(id)
  if (previous && (previous.data.text !== text || previous.data.tenantId !== tenantId || previous.data.conversationId !== conversationId || previous.data.sentBy !== actor)) throw new ConversationError('IDEMPOTENCY_CONFLICT')
  const create = overrides.createDoc || createDoc
  const update = overrides.updateDoc || updateDoc
  if (!previous) {
    const inserted = await create(id, { kind: 'OUTBOUND', tenantId, conversationId, channel: 'WHATSAPP', provider: 'META', phoneNumberId: context.phoneNumberId,
      inboundId: thread.lastInboundId, to: context.recipient, text, senderType: 'HUMAN', mode: 'HUMAN', sentBy: actor,
      correlationId: input.idempotencyKey, status: 'PREPARED', createdAt: new Date().toISOString(), attempts: '0' })
    if (inserted) await update(id, { status: 'PENDING' })
  }
  const result = await (overrides.sendOutbound || sendOutbound)(id, { conversationStore: overrides })
  const accepted = result.status === 'SENT'
  return { ok: accepted, status: accepted ? 'ACCEPTED' : result.status === 'UNKNOWN' || result.status === 'ALREADY_CLAIMED' ? 'UNKNOWN' : 'BLOCKED',
    outboundId: id, correlationId: input.idempotencyKey, deliveryStatus: accepted ? 'ACCEPTED' : null,
    ...(accepted ? {} : { reason: result.status }) }
}
