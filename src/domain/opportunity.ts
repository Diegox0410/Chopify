import type { CurrencyCode, EntityId, TenantScoped, Timestamped } from './shared'

export type OpportunityStatus = 'OPEN' | 'QUALIFIED' | 'CART_STARTED' | 'ORDER_CREATED' | 'WON' | 'LOST' | 'ABANDONED'
export type OpportunityIntent = 'PRODUCT_DISCOVERY' | 'PRODUCT_QUESTION' | 'PRICE_CHECK' | 'AVAILABILITY_CHECK' | 'PURCHASE_INTENT' | 'ORDER_STATUS' | 'PAYMENT_HELP' | 'DELIVERY_HELP' | 'COMPLAINT' | 'RETURN_REQUEST' | 'POST_SALE' | 'REPURCHASE' | 'GENERAL_QUESTION' | 'HUMAN_REQUEST' | 'UNKNOWN'

export interface Opportunity extends TenantScoped, Timestamped {
  id: EntityId
  customerId: EntityId
  conversationId?: EntityId
  intent: OpportunityIntent
  status: OpportunityStatus
  acquisitionSource?: string
  conversionChannel?: string
  estimatedValueCents?: number
  currency: CurrencyCode
}

const transitions: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  OPEN: ['QUALIFIED', 'LOST', 'ABANDONED'],
  QUALIFIED: ['CART_STARTED', 'ORDER_CREATED', 'LOST', 'ABANDONED'],
  CART_STARTED: ['ORDER_CREATED', 'LOST', 'ABANDONED'],
  ORDER_CREATED: ['WON', 'LOST'],
  WON: [], LOST: [], ABANDONED: ['OPEN'],
}
export const canTransitionOpportunity = (from: OpportunityStatus, to: OpportunityStatus) => transitions[from].includes(to)
export function transitionOpportunity(opportunity: Opportunity, to: OpportunityStatus, updatedAt: string): Opportunity {
  if (!canTransitionOpportunity(opportunity.status, to)) throw new Error(`Invalid opportunity transition: ${opportunity.status} -> ${to}`)
  return { ...opportunity, status: to, updatedAt }
}
