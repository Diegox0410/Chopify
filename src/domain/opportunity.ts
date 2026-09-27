import type { CurrencyCode, EntityId, TenantScoped, Timestamped } from './shared'

export type OpportunityStatus = 'OPEN' | 'QUALIFIED' | 'CART_STARTED' | 'ORDER_CREATED' | 'WON' | 'LOST' | 'ABANDONED'
export type OpportunityIntent = 'PRODUCT_DISCOVERY' | 'PRODUCT_QUESTION' | 'PRICE_CHECK' | 'AVAILABILITY_CHECK' | 'PURCHASE_INTENT' | 'ORDER_STATUS' | 'PAYMENT_HELP' | 'DELIVERY_HELP' | 'COMPLAINT' | 'RETURN_REQUEST' | 'POST_SALE' | 'REPURCHASE' | 'GENERAL_QUESTION' | 'HUMAN_REQUEST' | 'UNKNOWN'
export type OpportunityLossReason = 'PRICE' | 'NO_STOCK' | 'NO_RESPONSE' | 'CUSTOMER_CHANGED_MIND' | 'DELIVERY' | 'PAYMENT' | 'COMPETITOR' | 'NOT_QUALIFIED' | 'DUPLICATE' | 'OTHER'

export interface Opportunity extends TenantScoped, Timestamped {
  id: EntityId
  customerId: EntityId
  conversationId?: EntityId
  intent: OpportunityIntent
  status: OpportunityStatus
  acquisitionSource?: string
  conversionChannel?: string
  estimatedValueCents: number
  currency: CurrencyCode
  assignedTo?: EntityId
  lostReason?: OpportunityLossReason
  lostReasonDetail?: string
  abandonedReason?: string
  wonAt?: string
  lostAt?: string
  abandonedAt?: string
  lastActivityAt?: string
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
  return { ...opportunity, status: to, updatedAt, lastActivityAt: updatedAt }
}

export const qualifyOpportunity = (item: Opportunity, at: string) => transitionOpportunity(item, 'QUALIFIED', at)
export const startOpportunityCart = (item: Opportunity, at: string) => transitionOpportunity(item, 'CART_STARTED', at)
export const markOpportunityOrderCreated = (item: Opportunity, at: string) => transitionOpportunity(item, 'ORDER_CREATED', at)
export function winOpportunity(item: Opportunity, at: string): Opportunity {
  return { ...transitionOpportunity(item, 'WON', at), wonAt: at }
}
export function loseOpportunity(item: Opportunity, reason: OpportunityLossReason, at: string, detail?: string): Opportunity {
  if (reason === 'OTHER' && !detail?.trim()) throw new Error('OTHER loss reason requires detail')
  return { ...transitionOpportunity(item, 'LOST', at), lostAt: at, lostReason: reason, lostReasonDetail: detail?.trim() || undefined }
}
export function abandonOpportunity(item: Opportunity, at: string, reason?: string): Opportunity {
  return { ...transitionOpportunity(item, 'ABANDONED', at), abandonedAt: at, abandonedReason: reason?.trim() || undefined }
}
export function reopenOpportunity(item: Opportunity, at: string): Opportunity {
  const reopened = transitionOpportunity(item, 'OPEN', at)
  return { ...reopened, abandonedAt: undefined, abandonedReason: undefined }
}
export function updateOpportunityEstimatedValue(item: Opportunity, estimatedValueCents: number, at: string): Opportunity {
  if (!Number.isInteger(estimatedValueCents) || estimatedValueCents < 0) throw new Error('Estimated value must be a non-negative integer in cents')
  return { ...item, estimatedValueCents, updatedAt: at, lastActivityAt: at }
}
export function assignOpportunity(item: Opportunity, assignedTo: EntityId, at: string): Opportunity {
  if (!assignedTo.trim()) throw new Error('Assignee is required')
  return { ...item, assignedTo, updatedAt: at, lastActivityAt: at }
}
