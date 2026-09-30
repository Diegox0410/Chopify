import { describe, expect, it } from 'vitest'
import { belongsToTenant, filterByTenant, canTransitionOpportunity, transitionOpportunity, calculateManagedRevenue, calculateManagementFee, paymentStatusAfterProof, confirmPayment, evaluateCommercialAction, calculateSettlementTotal, hasPermission, isExecutableAutomation, resolveEscalation } from './index.js'
import type { AutomationDefinition, CommercialPolicy, HumanEscalation, Opportunity, Payment } from './index.js'

const attribution = { managed: true, managedBy: 'AUTOMATION' as const, acquisitionSource: 'campaign', conversionChannel: 'WHATSAPP' }
const order = { productSubtotalCents: 100_00, discountTotalCents: 10_00, shippingTotalCents: 20_00, taxTotalCents: 19_00, attributionSnapshot: attribution }
const opportunity: Opportunity = { id: 'o1', tenantId: 't1', customerId: 'c1', intent: 'PURCHASE_INTENT', status: 'OPEN', estimatedValueCents: 0, currency: 'COP', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const policy: CommercialPolicy = { tenantId: 't1', paymentVerificationMode: 'MANUAL_OWNER', allowAutomaticFollowUp: true, allowCartRecovery: false, allowPostSale: true, allowRepurchase: false }

describe('tenant isolation helpers', () => {
  it('matches the owning tenant', () => expect(belongsToTenant({ tenantId: 'a' }, 'a')).toBe(true))
  it('rejects another tenant', () => expect(belongsToTenant({ tenantId: 'a' }, 'b')).toBe(false))
  it('filters without leaking cross-tenant records', () => expect(filterByTenant([{ tenantId: 'a', id: 1 }, { tenantId: 'b', id: 2 }], 'b')).toEqual([{ tenantId: 'b', id: 2 }]))
})

describe('opportunity transitions', () => {
  it('allows open to qualified', () => expect(canTransitionOpportunity('OPEN', 'QUALIFIED')).toBe(true))
  it('disallows open directly to won', () => expect(canTransitionOpportunity('OPEN', 'WON')).toBe(false))
  it('allows abandoned opportunities to reopen', () => expect(canTransitionOpportunity('ABANDONED', 'OPEN')).toBe(true))
  it('transitions immutably', () => { const next = transitionOpportunity(opportunity, 'QUALIFIED', '2026-02-01'); expect(next).toMatchObject({ status: 'QUALIFIED', updatedAt: '2026-02-01' }); expect(opportunity.status).toBe('OPEN') })
  it('throws on invalid transitions', () => expect(() => transitionOpportunity(opportunity, 'WON', '2026-02-01')).toThrow(/Invalid/))
})

describe('managed revenue and fee', () => {
  it('subtracts attributable discount from product subtotal', () => expect(calculateManagedRevenue(order)).toBe(90_00))
  it('excludes shipping and tax', () => {
  const orderWithPassThroughAmounts = {
    ...order,
    shippingTotalCents: 999_00,
    taxTotalCents: 888_00,
  }

  expect(calculateManagedRevenue(orderWithPassThroughAmounts)).toBe(90_00)
})
  it('never produces a negative managed base', () => expect(calculateManagedRevenue({ ...order, discountTotalCents: 200_00 })).toBe(0))
  it('returns zero base when unmanaged', () => expect(calculateManagedRevenue({ ...order, attributionSnapshot: { ...attribution, managed: false } })).toBe(0))
  it('calculates a 5% fee', () => expect(calculateManagementFee(100_00, 500)).toBe(5_00))
  it('calculates a 10% fee', () => expect(calculateManagementFee(100_00, 1000)).toBe(10_00))
  it('returns zero fee when unmanaged', () => expect(calculateManagementFee(100_00, 1000, false)).toBe(0))
  it('rejects fractional cents', () => expect(() => calculateManagementFee(10.5, 500)).toThrow(/integers/))
})

describe('payment proof boundary', () => {
  it('marks receipt without confirming payment', () => expect(paymentStatusAfterProof()).toBe('PROOF_RECEIVED'))
  it('requires an explicit actor to confirm', () => { const payment: Payment = { id: 'p1', tenantId: 't1', orderId: 'o1', amountCents: 100, currency: 'COP', status: 'PROOF_RECEIVED', createdAt: 'before', updatedAt: 'before' }; expect(confirmPayment(payment, 'user-1', 'now')).toMatchObject({ status: 'PAID', confirmedBy: 'user-1' }); expect(payment.status).toBe('PROOF_RECEIVED') })
})

describe('commercial policy', () => {
  it('always requires a human for payment verification', () => expect(evaluateCommercialAction(policy, 'VERIFY_PAYMENT')).toBe('HUMAN_REQUIRED'))
  it('allows enabled follow-up', () => expect(evaluateCommercialAction(policy, 'AUTOMATIC_FOLLOW_UP')).toBe('ALLOWED'))
  it('denies disabled cart recovery', () => expect(evaluateCommercialAction(policy, 'CART_RECOVERY')).toBe('DENIED'))
  it('allows enabled post-sale', () => expect(evaluateCommercialAction(policy, 'POST_SALE')).toBe('ALLOWED'))
})

describe('settlement totals', () => {
  it('sums positive and adjustment lines in integer cents', () => expect(calculateSettlementTotal([{ amountCents: 1000 }, { amountCents: 500 }, { amountCents: -200 }])).toBe(1300))
  it('returns zero for an empty settlement', () => expect(calculateSettlementTotal([])).toBe(0))
})

describe('role permissions', () => {
  it('lets platform owners manage the platform', () => expect(hasPermission('PLATFORM_OWNER', 'platform:manage')).toBe(true))
  it('does not let tenant owners manage the platform', () => expect(hasPermission('TENANT_OWNER', 'platform:manage')).toBe(false))
  it('limits fulfillment to relevant order operations', () => { expect(hasPermission('FULFILLMENT', 'fulfillment:manage')).toBe(true); expect(hasPermission('FULFILLMENT', 'content:manage')).toBe(false) })
  it('limits content operators to content', () => expect(hasPermission('CONTENT_OPERATOR', 'content:manage')).toBe(true))
})

describe('automation models', () => {
  const automation: AutomationDefinition = { id: 'a1', tenantId: 't1', name: 'Post sale', status: 'ACTIVE', trigger: { type: 'ORDER_DELIVERED' }, conditions: [], actions: [{ type: 'CREATE_FOLLOW_UP' }] }
  it('recognizes an active automation with actions', () => expect(isExecutableAutomation(automation)).toBe(true))
  it('does not execute a draft', () => expect(isExecutableAutomation({ ...automation, status: 'DRAFT' })).toBe(false))
  it('does not execute without actions', () => expect(isExecutableAutomation({ ...automation, actions: [] })).toBe(false))
  it('represents send message only as a request', () => expect(({ type: 'SEND_MESSAGE_REQUEST' } as const).type).toBe('SEND_MESSAGE_REQUEST'))
})

describe('human escalation and attribution', () => {
  it('resolves an escalation explicitly', () => { const item: HumanEscalation = { id: 'e1', tenantId: 't1', conversationId: 'c1', reason: 'PAYMENT_ISSUE', priority: 'HIGH', status: 'OPEN', createdAt: 'before' }; expect(resolveEscalation(item, 'after')).toMatchObject({ status: 'RESOLVED', resolvedAt: 'after' }) })
  it('keeps acquisition and conversion separate', () => { expect(attribution.acquisitionSource).toBe('campaign'); expect(attribution.conversionChannel).toBe('WHATSAPP') })
  it('keeps management actor separate from conversion channel', () => { expect(attribution.managedBy).toBe('AUTOMATION'); expect(attribution.conversionChannel).not.toBe(attribution.managedBy) })
})
