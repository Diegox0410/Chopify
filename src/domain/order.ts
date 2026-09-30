import type { CommercialAgreementSnapshot } from './commercial.js'
import type { CurrencyCode, EntityId, ISODateTime, TenantScoped, Timestamped } from './shared.js'

export type OrderStatus = 'CREATED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
export type PaymentStatus = 'UNPAID' | 'PROOF_RECEIVED' | 'UNDER_REVIEW' | 'PAID' | 'REJECTED' | 'REFUNDED'
export type PaymentProofStatus = 'RECEIVED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'
export type FulfillmentStatus = 'UNFULFILLED' | 'PREPARING' | 'READY' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED'
export type ManagedBy = 'NONE' | 'HUMAN' | 'AUTOMATION' | 'MIXED'

export interface Attribution {
  acquisitionSource?: string
  conversionChannel?: string
  managed: boolean
  managedBy: ManagedBy
  automationAgent?: string
  campaignId?: EntityId
  conversationId?: EntityId
}
export interface OrderItemSnapshot {
  productId: EntityId; variantId?: EntityId; productName: string; variantName?: string
  quantity: number; unitPriceCents: number; discountCents: number; lineSubtotalCents: number; lineTotalCents: number
  imageUrl?: string; externalProductId?: string; externalVariantId?: string
}
export interface OrderTotals { productSubtotalCents: number; discountTotalCents: number; shippingTotalCents: number; taxTotalCents: number; otherPassThroughCents: number; grandTotalCents: number }
export interface ManagedOrderSnapshot { managed: boolean; managedBy: ManagedBy; managedOrderRateBps: number; managedRevenueBaseCents: number; managementFeeCents: number }
export interface Order extends TenantScoped, Timestamped, OrderTotals {
  id: EntityId; externalOrderId?: string; customerId: EntityId; opportunityId?: EntityId; conversationId?: EntityId
  currency: CurrencyCode; items: readonly OrderItemSnapshot[]
  orderStatus: OrderStatus; paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus
  attributionSnapshot: Readonly<Attribution>; commercialAgreementSnapshot?: Readonly<CommercialAgreementSnapshot>; managedSnapshot: Readonly<ManagedOrderSnapshot>
  confirmedAt?: ISODateTime; cancelledAt?: ISODateTime; cancellationReason?: string; completedAt?: ISODateTime
  fulfillmentDetails?: FulfillmentDetails
}
export interface PaymentProof extends TenantScoped {
  id: EntityId; paymentId: EntityId; orderId: EntityId; type: 'TRANSFER' | 'CASH_DEPOSIT' | 'OTHER'; reference?: string; assetReference?: string
  status: PaymentProofStatus; submittedAt: ISODateTime; reviewedAt?: ISODateTime; reviewedBy?: EntityId; rejectionReason?: string
}
export interface Payment extends TenantScoped, Timestamped {
  id: EntityId; orderId: EntityId; amountCents: number; currency: CurrencyCode; status: PaymentStatus
  paidAt?: ISODateTime; rejectedAt?: ISODateTime; refundedAt?: ISODateTime; confirmedBy?: EntityId
}
export interface FulfillmentDetails { courier?: string; trackingCode?: string; dispatchedAt?: ISODateTime; deliveredAt?: ISODateTime }

const assertCents = (value: number, label: string) => { if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer in cents`) }
export function createOrderItemSnapshot(input: Omit<OrderItemSnapshot, 'lineSubtotalCents' | 'lineTotalCents' | 'discountCents'> & { discountCents?: number }): OrderItemSnapshot {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('Quantity must be a positive integer')
  assertCents(input.unitPriceCents, 'Unit price'); const lineSubtotalCents = input.unitPriceCents * input.quantity; const discountCents = input.discountCents ?? 0; assertCents(discountCents, 'Discount')
  if (discountCents > lineSubtotalCents) throw new Error('Discount cannot exceed line subtotal')
  return { ...input, discountCents, lineSubtotalCents, lineTotalCents: lineSubtotalCents - discountCents }
}
export function calculateOrderTotals(items: readonly OrderItemSnapshot[], additions: { shippingCents?: number; taxCents?: number; otherPassThroughCents?: number } = {}): OrderTotals {
  if (!items.length) throw new Error('Order requires at least one item')
  const shippingTotalCents = additions.shippingCents ?? 0; const taxTotalCents = additions.taxCents ?? 0; const otherPassThroughCents = additions.otherPassThroughCents ?? 0
  assertCents(shippingTotalCents, 'Shipping'); assertCents(taxTotalCents, 'Tax'); assertCents(otherPassThroughCents, 'Other pass-through')
  const productSubtotalCents = items.reduce((sum, item) => sum + item.lineSubtotalCents, 0); const discountTotalCents = items.reduce((sum, item) => sum + item.discountCents, 0)
  return { productSubtotalCents, discountTotalCents, shippingTotalCents, taxTotalCents, otherPassThroughCents, grandTotalCents: Math.max(0, productSubtotalCents - discountTotalCents) + shippingTotalCents + taxTotalCents + otherPassThroughCents }
}
export const paymentStatusAfterProof = (): PaymentStatus => 'PROOF_RECEIVED'

export function receivePaymentProof(payment: Payment, at: ISODateTime): Payment {
  if (!['UNPAID', 'REJECTED'].includes(payment.status)) {
    throw new Error('Payment cannot receive a proof in its current state')
  }

  return {
    ...payment,
    status: 'PROOF_RECEIVED',
    updatedAt: at,
    rejectedAt: undefined,
  }
}

export function startPaymentReview(
  payment: Payment,
  proof: PaymentProof,
  at: ISODateTime,
): { payment: Payment; proof: PaymentProof } {
  if (proof.paymentId !== payment.id) {
    throw new Error('Proof does not belong to payment')
  }

  if (proof.orderId !== payment.orderId) {
    throw new Error('Proof and payment must belong to the same order')
  }

  if (payment.status === 'UNDER_REVIEW' && proof.status === 'UNDER_REVIEW') {
    return { payment, proof }
  }

  if (payment.status !== 'PROOF_RECEIVED') {
    throw new Error('Payment proof cannot enter review from its current state')
  }

  if (proof.status !== 'RECEIVED') {
    throw new Error('Proof cannot enter review from its current state')
  }

  return {
    payment: {
      ...payment,
      status: 'UNDER_REVIEW',
      updatedAt: at,
    },
    proof: {
      ...proof,
      status: 'UNDER_REVIEW',
    },
  }
}

export function approvePayment(payment: Payment, actorId: EntityId, at: ISODateTime): Payment { if (!['PROOF_RECEIVED', 'UNDER_REVIEW'].includes(payment.status)) throw new Error('Payment proof is not reviewable'); return { ...payment, status: 'PAID', confirmedBy: actorId, paidAt: at, updatedAt: at } }
export const confirmPayment = approvePayment
export function rejectPayment(payment: Payment, at: ISODateTime): Payment { if (!['PROOF_RECEIVED', 'UNDER_REVIEW'].includes(payment.status)) throw new Error('Payment proof is not reviewable'); return { ...payment, status: 'REJECTED', rejectedAt: at, updatedAt: at } }
export function approveProof(proof: PaymentProof, reviewerId: string, at: string): PaymentProof { if (!['RECEIVED', 'UNDER_REVIEW'].includes(proof.status)) throw new Error('Proof is not reviewable'); return { ...proof, status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: at } }
export function rejectProof(proof: PaymentProof, reviewerId: string, reason: string, at: string): PaymentProof { if (!reason.trim()) throw new Error('Rejection reason is required'); if (!['RECEIVED', 'UNDER_REVIEW'].includes(proof.status)) throw new Error('Proof is not reviewable'); return { ...proof, status: 'REJECTED', reviewedBy: reviewerId, reviewedAt: at, rejectionReason: reason.trim() } }
export function cancelOrder(order: Order, reason: string, at: string): Order { if (!reason.trim()) throw new Error('Cancellation reason is required'); if (order.orderStatus === 'CANCELLED') return order; if (order.orderStatus === 'COMPLETED' || order.paymentStatus === 'PAID') throw new Error('Paid or completed orders require an explicit refund/restock flow'); return { ...order, orderStatus: 'CANCELLED', fulfillmentStatus: 'CANCELLED', cancelledAt: at, cancellationReason: reason.trim(), updatedAt: at } }
export function startPreparation(order: Order, at: string): Order { if (order.paymentStatus !== 'PAID') throw new Error('Prepaid SAMPLE orders require PAID before preparation'); if (order.fulfillmentStatus !== 'UNFULFILLED') throw new Error('Only unfulfilled orders can start preparation'); return { ...order, fulfillmentStatus: 'PREPARING', updatedAt: at } }
export function markReady(order: Order, at: string): Order { if (order.fulfillmentStatus !== 'PREPARING') throw new Error('Only preparing orders can be ready'); return { ...order, fulfillmentStatus: 'READY', updatedAt: at } }
export function dispatchOrder(order: Order, details: Pick<FulfillmentDetails, 'courier' | 'trackingCode'>, at: string): Order { if (order.fulfillmentStatus !== 'READY') throw new Error('Only ready orders can be dispatched'); return { ...order, fulfillmentStatus: 'DISPATCHED', fulfillmentDetails: { ...order.fulfillmentDetails, ...details, dispatchedAt: at }, updatedAt: at } }
export function markDelivered(order: Order, at: string): Order { if (order.fulfillmentStatus !== 'DISPATCHED') throw new Error('Only dispatched orders can be delivered'); if (order.paymentStatus !== 'PAID') throw new Error('Delivered completion requires paid order'); return { ...order, fulfillmentStatus: 'DELIVERED', orderStatus: 'COMPLETED', completedAt: at, fulfillmentDetails: { ...order.fulfillmentDetails, deliveredAt: at }, updatedAt: at } }
