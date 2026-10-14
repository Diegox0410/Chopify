import { createHash } from 'node:crypto'

export const orderNotificationTransitions = Object.freeze({
  approvePayment: 'PAYMENT_APPROVED', rejectPaymentProof: 'PAYMENT_REJECTED',
  startPreparation: 'PREPARING', markReady: 'READY', dispatchOrder: 'DISPATCHED', markDelivered: 'DELIVERED',
})
const fingerprint = value => createHash('sha256').update(value).digest('hex')
const safeResult = (status, id, reason) => ({ status, ...(id ? { correlationId: id, outboundId: id } : {}), ...(reason ? { reason } : {}) })
const publicStatus = item => item?.status === 'SENT' ? 'ACCEPTED' : item?.status === 'UNKNOWN' || item?.status === 'SENDING' ? 'UNKNOWN' : item?.status || 'NOT_FOUND'
function confirmedTransition(kind, detail, input) {
  if (kind === 'PAYMENT_APPROVED') return detail.order.paymentStatus === 'PAID' && detail.payment.status === 'PAID'
    && detail.payment.id === input.paymentId && detail.proofs.some(proof => proof.id === input.proofId && proof.paymentId === input.paymentId && proof.status === 'APPROVED')
  if (kind === 'PAYMENT_REJECTED') return detail.order.paymentStatus === 'REJECTED'
    && detail.payment.id === input.paymentId && detail.proofs.some(proof => proof.id === input.proofId && proof.status === 'REJECTED')
  return detail.order.paymentStatus === 'PAID' && detail.order.fulfillmentStatus === kind
}
function notificationText(kind, order) {
  const reference = String(order.operationNumber || order.id)
  return {
    PAYMENT_APPROVED: `FLOES aprobó tu pago. El pedido ${reference} está confirmado.`,
    PAYMENT_REJECTED: `El comprobante del pedido ${reference} requiere corrección. Por favor, contacta a FLOES para revisarlo.`,
    PREPARING: `Tu pedido ${reference} está en preparación.`,
    READY: `Tu pedido ${reference} está listo para el despacho o retiro acordado.`,
    DISPATCHED: `FLOES registró el despacho de tu pedido ${reference}.${order.fulfillmentDetails?.trackingCode ? ` Guía: ${order.fulfillmentDetails.trackingCode}.` : ''}`,
    DELIVERED: `FLOES registró la entrega de tu pedido ${reference}. Si necesitas ayuda, puedes escribirnos por este canal.`,
  }[kind]
}

/** Same durable outbox as inbound replies. Only a creator sends; uncertain sends never retry blindly. */
export function createOrderNotificationService(dependencies) {
  const { runtime, get, create, update, send, context, clock = () => new Date().toISOString() } = dependencies
  return async function notify({ operation, tenantId, input = {}, data }) {
    const kind = orderNotificationTransitions[operation]
    if (!kind) return { status: 'NOT_APPLICABLE' }
    const orderId = data?.orderId || input.orderId
    if (typeof orderId !== 'string') return safeResult('BLOCKED', undefined, 'ORDER_REFERENCE_MISSING')
    const detail = await runtime.execute({ operation: 'getOrderDetail', tenantId, input: { orderId } })
    if (!detail || detail.order.tenantId !== tenantId || detail.payment.tenantId !== tenantId
      || detail.proofs.some(proof => proof.tenantId !== tenantId || proof.orderId !== orderId)) return safeResult('BLOCKED', undefined, 'ORDER_CONTEXT_MISMATCH')
    if (!confirmedTransition(kind, detail, input)) return safeResult('BLOCKED', undefined, 'TRANSITION_NOT_CONFIRMED')
    const conversationId = detail.order.conversationId
    if (typeof conversationId !== 'string' || !conversationId) return safeResult('BLOCKED', undefined, 'ORIGIN_CONVERSATION_MISSING')
    const transitionKey = kind === 'PAYMENT_REJECTED' ? input.proofId : kind === 'PAYMENT_APPROVED' ? input.paymentId : kind
    const id = `out_order_${fingerprint(`${tenantId}:${orderId}:${kind}:${transitionKey}`)}`
    const previous = await get(id)
    if (previous) {
      if (previous.tenantId !== tenantId || previous.orderId !== orderId || previous.conversationId !== conversationId) return safeResult('BLOCKED', id, 'OUTBOX_CONTEXT_MISMATCH')
      return safeResult(publicStatus(previous), id)
    }
    const origin = await context({ tenantId, conversationId })
    if (!origin || origin.tenantId !== tenantId || origin.conversationId !== conversationId || origin.channel !== 'WHATSAPP'
      || !/^\d{8,15}$/.test(origin.recipient || '') || !/^\d{5,30}$/.test(origin.phoneNumberId || '')) return safeResult('BLOCKED', id, 'CHANNEL_CONTEXT_UNAVAILABLE')
    if (detail.customer?.phone && String(detail.customer.phone).replace(/\D/g, '') !== origin.recipient) return safeResult('BLOCKED', id, 'CUSTOMER_CHANNEL_MISMATCH')
    const createdAt = clock()
    const elapsed = Date.parse(createdAt) - Date.parse(origin.lastCustomerMessageAt)
    const inWindow = Number.isFinite(elapsed) && elapsed >= -300000 && elapsed < 86400000
    const record = { kind: 'OUTBOUND', tenantId, orderId, customerId: detail.order.customerId, conversationId,
      channel: 'WHATSAPP', provider: 'META', to: origin.recipient, phoneNumberId: origin.phoneNumberId,
      senderType: 'SYSTEM', mode: 'SYSTEM', eventStatus: kind, text: notificationText(kind, detail.order),
      correlationId: id, createdAt, status: inWindow ? 'PREPARED' : 'BLOCKED_WINDOW', attempts: '0' }
    if (!await create(id, record)) return safeResult(publicStatus(await get(id)), id)
    if (!inWindow) return safeResult('BLOCKED_WINDOW', id, 'APPROVED_TEMPLATE_REQUIRED')
    await update(id, { status: 'PENDING' })
    try {
      const result = await send(id)
      if (result?.status === 'SENT') return safeResult('ACCEPTED', id)
      const current = await get(id)
      const actual = publicStatus(current)
      if (actual !== 'ACCEPTED' && actual !== 'UNKNOWN') await update(id, { status: 'BLOCKED', technicalReason: result?.status || 'PROVIDER_NOT_ACCEPTED' })
      return safeResult(actual === 'ACCEPTED' ? 'ACCEPTED' : actual === 'UNKNOWN' ? 'UNKNOWN' : 'BLOCKED', id, result?.status)
    } catch {
      // A provider timeout can mean accepted. Keep a durable ambiguous record.
      const current = await get(id)
      if (current?.status === 'SENT') return safeResult('ACCEPTED', id)
      await update(id, { status: 'UNKNOWN', technicalReason: 'NOTIFICATION_SEND_UNCERTAIN' })
      return safeResult('UNKNOWN', id, 'NOTIFICATION_SEND_UNCERTAIN')
    }
  }
}
