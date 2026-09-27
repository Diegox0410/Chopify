import type { EntityId, ISODateTime, TenantScoped } from './shared'
import type { Attribution, Order } from './order'

export interface CommercialAgreement extends TenantScoped {
  id: EntityId; effectiveFrom: ISODateTime; effectiveTo?: ISODateTime; managedOrderRateBps: number; publicationFeeCents: number; annualContinuityFeeCents: number; rulesVersion: string; createdAt: ISODateTime
}
export interface CommercialAgreementSnapshot { agreementId: EntityId; managedOrderRateBps: number; publicationFeeCents: number; annualContinuityFeeCents: number; rulesVersion: string; capturedAt: ISODateTime }
export interface ManagedSale extends TenantScoped { id: EntityId; orderId: EntityId; managedRevenueCents: number; managementFeeCents: number; agreementSnapshot: CommercialAgreementSnapshot; attribution: Attribution; createdAt: ISODateTime }

export function calculateManagedRevenue(order: Pick<Order, 'productSubtotalCents' | 'discountTotalCents' | 'shippingTotalCents' | 'taxTotalCents' | 'attribution'>): number {
  if (!order.attribution.managed) return 0
  return Math.max(0, order.productSubtotalCents - order.discountTotalCents)
}
export function calculateManagementFee(managedRevenueCents: number, rateBps: number, managed = true): number {
  if (!managed) return 0
  if (!Number.isInteger(managedRevenueCents) || !Number.isInteger(rateBps) || managedRevenueCents < 0 || rateBps < 0) throw new Error('Money and rates must be non-negative integers')
  return Math.round((managedRevenueCents * rateBps) / 10_000)
}
