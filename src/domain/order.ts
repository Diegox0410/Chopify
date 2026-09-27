import type { CurrencyCode, EntityId, ISODateTime, TenantScoped, Timestamped } from './shared'

export type OrderStatus = 'CREATED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
export type PaymentStatus = 'UNPAID' | 'PROOF_RECEIVED' | 'UNDER_REVIEW' | 'PAID' | 'REJECTED' | 'REFUNDED'
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
export interface Order extends TenantScoped, Timestamped {
  id: EntityId; externalOrderId?: string; customerId: EntityId; opportunityId?: EntityId; conversationId?: EntityId
  currency: CurrencyCode; productSubtotalCents: number; discountTotalCents: number; shippingTotalCents: number; taxTotalCents: number; grandTotalCents: number
  orderStatus: OrderStatus; paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus; attribution: Attribution
}
export interface PaymentProof extends TenantScoped {
  id: EntityId; orderId: EntityId; status: 'RECEIVED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'; submittedAt: ISODateTime; reviewedAt?: ISODateTime; reviewedBy?: EntityId
}
export interface Payment extends TenantScoped { id: EntityId; orderId: EntityId; status: PaymentStatus; confirmedAt?: ISODateTime; confirmedBy?: EntityId }
export interface FulfillmentDetails { courier?: string; trackingReference?: string; dispatchedAt?: ISODateTime; deliveredAt?: ISODateTime }

export const paymentStatusAfterProof = (): PaymentStatus => 'PROOF_RECEIVED'
export function confirmPayment(payment: Payment, actorId: EntityId, at: ISODateTime): Payment {
  return { ...payment, status: 'PAID', confirmedBy: actorId, confirmedAt: at }
}
