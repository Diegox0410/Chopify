import { createHash } from 'node:crypto'

const eventTime = item => item.sentAt || item.createdAt || item.receivedAt || ''
const outboundText = item => {
  const parts = [item.text]
  try {
    const messages = JSON.parse(item.messagesJson || '[]')
    if (Array.isArray(messages)) for (const message of messages) {
      if (message?.type === 'text' && typeof message.text === 'string') parts.push(message.text)
      if (message?.type === 'image' && typeof message.caption === 'string') parts.push(message.caption)
    }
  } catch { /* legacy outbox rows keep their text field */ }
  return [...new Set(parts.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].join('\n')
}

function groupLiveConversations(documents, tenantId) {
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
    const id = item.conversationId || `conversation_${createHash('sha256').update(`${tenantId}:WHATSAPP:${externalId}`).digest('hex')}`
    const group = byConversation.get(id) || { id, events: [], latestInbound: item }
    group.events.push(item)
    if (eventTime(item) > eventTime(group.latestInbound)) group.latestInbound = item
    byConversation.set(id, group)
  }
  return [...byConversation.values()].map(group => {
    const events = group.events.flatMap(item => [
      { id: item.id, direction: 'INBOUND', senderType: 'CLIENT', text: item.text || '', createdAt: eventTime(item), status: item.status || 'RECEIVED' },
      ...(outByInbound.get(item.id) || []).map(outbound => ({ id: outbound.id, direction: 'OUTBOUND', senderType: outbound.senderType === 'HUMAN' || outbound.mode === 'HUMAN' ? 'HUMAN' : outbound.senderType === 'SYSTEM' || outbound.mode === 'SYSTEM' ? 'SISTEMA' : 'GANOBOT', text: outboundText(outbound), createdAt: eventTime(outbound), status: outbound.status || 'PENDING' })),
    ]).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const latestInbound = group.latestInbound
    const thread = metadata.get(group.id)
    const outbound = group.events.flatMap(item => outByInbound.get(item.id) || []).sort((a, b) => eventTime(a).localeCompare(eventTime(b))).at(-1)
    const requiresHuman = thread ? thread.requiresHuman === 'true' : group.events.some(item => ['NEEDS_HUMAN', 'HUMAN_QUEUED'].includes(item.status))
    return {
      id: group.id, tenantId, channel: 'WHATSAPP', contact: latestInbound.name || 'Cliente WhatsApp',
      lastActivityAt: events.at(-1)?.createdAt || eventTime(latestInbound), messageCount: events.length,
      timeline: events, status: events.at(-1)?.status || latestInbound.status || 'RECEIVED',
      mode: thread?.mode || outbound?.mode || (requiresHuman ? 'HUMAN' : 'GANOBOT_LIVE'), requiresHuman,
      unreadCount: group.events.filter(item => eventTime(item) > (thread?.readAt || '')).length,
      outbound: outbound ? { status: outbound.status || 'PENDING', mode: outbound.mode || '', attempts: Number(outbound.attempts || 0), createdAt: outbound.createdAt || '', sentAt: outbound.sentAt || '', providerMessageId: outbound.providerMessageId || '', error: outbound.error || '', httpStatus: outbound.httpStatus ? Number(outbound.httpStatus) : null, metaErrorCode: outbound.metaErrorCode ? Number(outbound.metaErrorCode) : null, metaErrorType: outbound.metaErrorType || '', fbtraceId: outbound.fbtraceId || '' } : null,
    }
  }).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
}

const digits = value => String(value || '').replace(/\D/g, '')
export const operationalAlertId = (tenantId, type, sourceId) => `alert_${createHash('sha256').update(`${tenantId}:${type}:${sourceId}`).digest('hex')}`

export function paginateCommandCenterConversations(snapshot, cursor) {
  let after = 0
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    if (typeof cursor !== 'string' || cursor.length > 2048) throw new Error('Invalid conversation cursor')
    let decoded
    try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) }
    catch { throw new Error('Invalid conversation cursor') }
    if (typeof decoded.id !== 'string' || typeof decoded.lastActivityAt !== 'string') throw new Error('Invalid conversation cursor')
    const exact = snapshot.conversations.findIndex(item => item.id === decoded.id && item.lastActivityAt === decoded.lastActivityAt)
    after = exact >= 0 ? exact + 1 : snapshot.conversations.findIndex(item => item.lastActivityAt < decoded.lastActivityAt || (item.lastActivityAt === decoded.lastActivityAt && item.id < decoded.id))
    if (after < 0) after = snapshot.conversations.length
  }
  const conversations = snapshot.conversations.slice(after, after + 25)
  const hasMore = after + conversations.length < snapshot.conversations.length
  const last = conversations.at(-1)
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ id: last.id, lastActivityAt: last.lastActivityAt })).toString('base64url') : undefined
  return { ...snapshot, conversations, ...(nextCursor ? { nextCursor } : {}) }
}

export function buildNotificationsReadModel(documents, tenantIds) {
  const allowedTenants = new Set(tenantIds)
  const alerts = documents.filter(item => item.id.startsWith('alert_') && allowedTenants.has(item.tenantId))
    .map(alert => ({ id: alert.id, tenantId: alert.tenantId, type: alert.type || 'OTHER', summary: alert.summary || '', href: alert.href || '', read: alert.read === 'true', createdAt: alert.createdAt || '' }))
    .sort((a,b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt))
  return { alerts, unreadAlertCount: alerts.filter(alert => !alert.read).length }
}

export function buildCommandCenterReadModel({ documents, orders, customers, reviews, activities = [], opportunities = [], tenantId }) {
  const phoneToCustomer = new Map(customers.map(customer => [digits(customer.phone), customer]).filter(([phone]) => phone))
  const reviewsByOrder = new Map(reviews.map(review => [review.order.id, review]))
  const inboundsByConversation = new Map()
  const opportunitiesByConversation = new Map()
  const opportunitiesByCustomer = new Map()
  const ordersByConversation = new Map()
  const ordersByCustomer = new Map()
  const activitiesByOrder = new Map()
  const add = (map, key, value) => {
    if (!key) return
    const values = map.get(key) || []
    values.push(value)
    map.set(key, values)
  }
  for (const document of documents) if (document.id.startsWith('in_') && document.tenantId === tenantId) add(inboundsByConversation, document.conversationId, document)
  for (const opportunity of opportunities) if (opportunity.tenantId === tenantId) {
    add(opportunitiesByConversation, opportunity.conversationId, opportunity)
    add(opportunitiesByCustomer, opportunity.customerId, opportunity)
  }
  for (const order of orders) if (order.tenantId === tenantId) {
    add(ordersByConversation, order.conversationId, order)
    add(ordersByCustomer, order.customerId, order)
  }
  for (const activity of activities) if (activity.tenantId === tenantId) add(activitiesByOrder, activity.orderId, activity)
  for (const inbound of inboundsByConversation.values()) inbound.sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')))
  const conversations = groupLiveConversations(documents, tenantId).map(conversation => {
    const inbound = inboundsByConversation.get(conversation.id) || []
    const phone = digits(inbound.at(-1)?.from)
    const customer = phoneToCustomer.get(phone)
    const opportunityRows = [...new Map([...(opportunitiesByConversation.get(conversation.id) || []), ...(customer ? opportunitiesByCustomer.get(customer.id) || [] : [])].map(item => [item.id, item])).values()]
    const activeOpportunity = opportunityRows.filter(opportunity => !['WON', 'LOST', 'ABANDONED'].includes(opportunity.status))
      .sort((a,b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0]
    const linkedOrders = [...new Map([...(ordersByConversation.get(conversation.id) || []), ...(customer ? ordersByCustomer.get(customer.id) || [] : [])].map(item => [item.id, item])).values()]
      .sort((a,b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    const order = linkedOrders.find(item => !['CANCELLED', 'COMPLETED'].includes(item.orderStatus)) || linkedOrders[0]
    const review = order ? reviewsByOrder.get(order.id) : undefined
    const item = order?.items?.[0]
    const orderActivities = order ? activitiesByOrder.get(order.id) || [] : []
    const operationalEvents = orderActivities.length ? orderActivities.map(activity => ({ id: `activity-${activity.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: activity.summary || activity.type.replaceAll('_', ' '), createdAt: activity.occurredAt, status: activity.type })) : order ? [
      { id: `event-order-${order.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: 'Pedido creado', createdAt: order.createdAt, status: 'ORDER_CREATED' },
      ...(review?.proof ? [{ id: `event-proof-${review.proof.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: 'Comprobante recibido · pago pendiente', createdAt: review.proof.submittedAt, status: 'PAYMENT_PROOF_PENDING' }] : []),
      ...(order.paymentStatus === 'PAID' ? [{ id: `event-paid-${order.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: 'Pago aprobado', createdAt: order.updatedAt, status: 'PAYMENT_APPROVED' }] : []),
      ...(order.paymentStatus === 'REJECTED' ? [{ id: `event-rejected-${order.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: 'Pago rechazado', createdAt: order.updatedAt, status: 'PAYMENT_REJECTED' }] : []),
      ...(order.fulfillmentStatus === 'PREPARING' ? [{ id: `event-preparing-${order.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: 'Pedido en preparación', createdAt: order.updatedAt, status: 'PREPARING' }] : []),
      ...(order.fulfillmentStatus === 'READY' ? [{ id: `event-ready-${order.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: 'Pedido listo', createdAt: order.updatedAt, status: 'READY' }] : []),
      ...(order.fulfillmentStatus === 'DISPATCHED' ? [{ id: `event-dispatched-${order.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: 'Pedido enviado', createdAt: order.fulfillmentDetails?.dispatchedAt || order.updatedAt, status: 'DISPATCHED' }] : []),
      ...(order.fulfillmentStatus === 'DELIVERED' ? [{ id: `event-delivered-${order.id}`, direction: 'EVENT', senderType: 'SISTEMA', text: 'Pedido entregado', createdAt: order.fulfillmentDetails?.deliveredAt || order.updatedAt, status: 'DELIVERED' }] : []),
    ] : []
    const alerts = [
      ...(conversation.requiresHuman ? ['NEEDS_HUMAN'] : []),
      ...(review?.proof ? ['PAYMENT_PENDING'] : []),
      ...(order?.paymentStatus === 'REJECTED' ? ['PAYMENT_REJECTED'] : []),
      ...(order?.fulfillmentStatus === 'READY' ? ['READY'] : []),
      ...(conversation.outbound && ['FAILED', 'ERROR', 'UNKNOWN'].includes(conversation.outbound.status) ? ['WHATSAPP_ERROR'] : []),
      ...(inbound.some(event => event.status === 'NEEDS_HUMAN' && event.technicalReason) ? ['GANOBOT_ERROR'] : []),
    ]
    return {
      ...conversation,
      contact: customer?.name || conversation.contact,
      maskedPhone: phone ? `**** ${phone.slice(-4)}` : '',
      selection: item ? { model: item.productName || '', color: item.variantName || '', size: item.size || '' } : null,
      opportunity: activeOpportunity ? { id: activeOpportunity.id, status: activeOpportunity.status, intent: activeOpportunity.intent } : null,
      order: order ? { id: order.id, status: order.orderStatus, fulfillmentStatus: order.fulfillmentStatus, paymentStatus: order.paymentStatus, customerId: order.customerId, createdAt: order.createdAt, updatedAt: order.updatedAt } : null,
      payment: order ? { status: review?.proof?.status || (order.paymentStatus === 'PAID' ? 'APPROVED' : order.paymentStatus === 'REJECTED' ? 'REJECTED' : order.paymentStatus === 'PROOF_RECEIVED' || order.paymentStatus === 'UNDER_REVIEW' ? 'PENDING' : 'NOT_RECEIVED'), proofId: review?.proof?.id || '', paymentId: review?.payment?.id || '' } : null,
      alerts,
      timeline: [...conversation.timeline, ...operationalEvents].filter(event => event.createdAt).sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(-30),
      orderPath: order ? `/orders/${tenantId}/${order.id}` : '',
    }
  })

  const candidates = []
  for (const conversation of conversations) {
    if (conversation.requiresHuman) candidates.push({ type: 'NEEDS_HUMAN', sourceId: conversation.id, summary: `Conversación requiere atención — ${conversation.contact}`, href: '/conversations' })
    if (conversation.payment?.status === 'PENDING') candidates.push({ type: 'PAYMENT_PENDING', sourceId: conversation.payment.proofId, summary: `Pago pendiente — ${conversation.maskedPhone}`, href: '/payments' })
    if (conversation.payment?.status === 'REJECTED' && conversation.order) candidates.push({ type: 'PAYMENT_REJECTED', sourceId: `${conversation.order.id}:${conversation.order.updatedAt}`, summary: `Pago rechazado — ${conversation.maskedPhone}`, href: conversation.orderPath })
    if (conversation.order?.fulfillmentStatus === 'READY') candidates.push({ type: 'READY', sourceId: `${conversation.order.id}:${conversation.order.updatedAt}`, summary: `Pedido listo para despacho — ${conversation.maskedPhone}`, href: conversation.orderPath })
    if (conversation.outbound && ['FAILED', 'ERROR', 'UNKNOWN'].includes(conversation.outbound.status)) candidates.push({ type: 'WHATSAPP_ERROR', sourceId: conversation.id, summary: `Error de WhatsApp — ${conversation.contact}`, href: '/conversations' })
    if (conversation.alerts.includes('GANOBOT_ERROR')) candidates.push({ type: 'GANOBOT_ERROR', sourceId: conversation.id, summary: `Error de GanoBot — ${conversation.contact}`, href: '/conversations' })
  }
  return { conversations, candidates }
}
