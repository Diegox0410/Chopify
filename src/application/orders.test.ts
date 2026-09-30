import { beforeEach, describe, expect, it } from 'vitest'
import { createSampleRepositories } from '../adapters/memory/commercialRepositories.js'
import { createSampleOrderRepositories } from '../adapters/memory/orderRepositories.js'
import type { ActorContext } from '../domain/index.js'
import { CommercialApplication } from './commercial.js'
import { OrderApplication } from './orders.js'

let now = '2026-09-27T12:00:00.000Z'
const clock = () => now

const tenantOwner: ActorContext = { actorId: 'owner-mg', role: 'TENANT_OWNER', tenantId: 'tenant-mg' }
const operator: ActorContext = { actorId: 'operator-mg', role: 'OPERATOR', tenantId: 'tenant-mg' }
const automation: ActorContext = { actorId: 'gano-bot', role: 'AUTOMATION', tenantId: 'tenant-mg' }

function setup() {
  const commercialRepositories = createSampleRepositories()
  const orderRepositories = createSampleOrderRepositories()
  const commercial = new CommercialApplication(commercialRepositories, clock)
  const orders = new OrderApplication({
    tenants: commercialRepositories.tenants,
    customers: commercialRepositories.customers,
    opportunities: commercialRepositories.opportunities,
    activities: commercialRepositories.activities,
    ...orderRepositories,
  }, clock)
  return { commercial, orders, orderRepositories }
}

async function orderReadyOpportunity(commercial: CommercialApplication) {
  const customer = await commercial.createCustomer({ tenantId: 'tenant-mg', name: 'Cliente H3' })
  const opportunity = await commercial.createOpportunity({
    tenantId: 'tenant-mg',
    customerId: customer.id,
    intent: 'PURCHASE_INTENT',
    estimatedValueCents: 10_000,
    currency: 'COP',
    acquisitionSource: 'WEB',
    conversionChannel: 'WEB',
  })
  await commercial.qualifyOpportunity('tenant-mg', opportunity.id)
  await commercial.startOpportunityCart('tenant-mg', opportunity.id)
  return commercial.markOpportunityOrderCreated('tenant-mg', opportunity.id)
}

async function createStockOrder(app: ReturnType<typeof setup>, key = 'create-1', additions: { shippingCents?: number; taxCents?: number; otherPassThroughCents?: number } = {}) {
  const opportunity = await orderReadyOpportunity(app.commercial)
  return app.orders.createOrderFromOpportunity({
    tenantId: 'tenant-mg',
    opportunityId: opportunity.id,
    items: [{ productId: 'mg-stock-1', quantity: 1 }],
    ...additions,
    idempotencyKey: key,
    actor: tenantOwner,
  })
}

beforeEach(() => { now = '2026-09-27T12:00:00.000Z' })

describe('H3 application order creation and commercial snapshots', () => {
  it('creates order, UNPAID payment and ACTIVE STOCK reservation', async () => {
    const app = setup()
    const order = await createStockOrder(app)
    const detail = await app.orders.getOrderDetail('tenant-mg', order.id)
    expect(detail?.payment.status).toBe('UNPAID')
    expect(detail?.reservation?.status).toBe('ACTIVE')
    expect(order.items[0]).toMatchObject({ productId: 'mg-stock-1', productName: 'Kit Esencial SAMPLE', unitPriceCents: 10_000 })
  })

  it('snapshots 5% agreement and excludes pass-through from managed base', async () => {
    const app = setup()
    const order = await createStockOrder(app, 'create-fee', { shippingCents: 600, taxCents: 400, otherPassThroughCents: 300 })
    expect(order.grandTotalCents).toBe(11_300)
    expect(order.managedSnapshot).toMatchObject({ managedRevenueBaseCents: 10_000, managedOrderRateBps: 500, managementFeeCents: 500 })
  })

  it('reserves STOCK exactly once on completed idempotent retry', async () => {
    const app = setup()
    const opportunity = await orderReadyOpportunity(app.commercial)
    const input = { tenantId: 'tenant-mg', opportunityId: opportunity.id, items: [{ productId: 'mg-stock-1', quantity: 1 }], idempotencyKey: 'same-key', actor: tenantOwner } as const
    const first = await app.orders.createOrderFromOpportunity(input)
    const afterFirst = await app.orderRepositories.commerce.getAvailability('tenant-mg', 'mg-stock-1')
    const second = await app.orders.createOrderFromOpportunity(input)
    const afterSecond = await app.orderRepositories.commerce.getAvailability('tenant-mg', 'mg-stock-1')
    expect(second.id).toBe(first.id)
    expect(afterSecond).toBe(afterFirst)
  })

  it('blocks unsafe retry when idempotency is STARTED', async () => {
    const app = setup()
    const opportunity = await orderReadyOpportunity(app.commercial)
    await app.orderRepositories.idempotency.save('tenant-mg', { tenantId: 'tenant-mg', operation: 'CREATE_ORDER', key: 'stuck', status: 'STARTED', createdAt: now })
    await expect(app.orders.createOrderFromOpportunity({ tenantId: 'tenant-mg', opportunityId: opportunity.id, items: [{ productId: 'mg-stock-1', quantity: 1 }], idempotencyKey: 'stuck', actor: tenantOwner })).rejects.toThrow('Operation already in progress or requires recovery')
  })

  it('rejects insufficient STOCK inventory', async () => {
    const app = setup()
    const opportunity = await orderReadyOpportunity(app.commercial)
    await expect(app.orders.createOrderFromOpportunity({ tenantId: 'tenant-mg', opportunityId: opportunity.id, items: [{ productId: 'mg-limited', quantity: 2 }], idempotencyKey: 'insufficient', actor: tenantOwner })).rejects.toThrow('Insufficient STOCK inventory')
  })

  it('does not create a reservation for MADE_TO_ORDER', async () => {
    const app = setup()
    const product = await app.orderRepositories.commerce.getProduct('tenant-floes', 'floes-scrub-maria-jose')
    if (!product) throw new Error('FLOES fixture missing')
    await app.orderRepositories.commerce.upsertProducts('tenant-floes', [{ ...product, pricingStatus: 'READY', salePriceCents: 32_000 }])
    const customer = await app.commercial.createCustomer({ tenantId: 'tenant-floes', name: 'Cliente FLOES H3' })
    const opportunity = await app.commercial.createOpportunity({ tenantId: 'tenant-floes', customerId: customer.id, intent: 'PURCHASE_INTENT', estimatedValueCents: 32_000, currency: 'COP' })
    await app.commercial.qualifyOpportunity('tenant-floes', opportunity.id)
    await app.commercial.startOpportunityCart('tenant-floes', opportunity.id)
    await app.commercial.markOpportunityOrderCreated('tenant-floes', opportunity.id)
    const order = await app.orders.createOrderFromOpportunity({ tenantId: 'tenant-floes', opportunityId: opportunity.id, items: [{ productId: product.id, quantity: 1 }], idempotencyKey: 'mto', actor: { actorId: 'owner-fl', role: 'TENANT_OWNER', tenantId: 'tenant-floes' } })
    expect((await app.orders.getOrderDetail('tenant-floes', order.id))?.reservation).toBeNull()
  })
})

describe('H3 payment review, authorization and inventory commit', () => {
  it('proof -> review -> approval and commits reserved inventory once', async () => {
    const app = setup()
    const order = await createStockOrder(app)
    const proof = await app.orders.submitPaymentProof({ tenantId: 'tenant-mg', orderId: order.id, idempotencyKey: 'proof-1', actor: operator })
    const beforeReview = await app.orderRepositories.commerce.getPosition('tenant-mg', 'mg-stock-1')
    const beforeReviewSnapshot = beforeReview ? { onHand: beforeReview.onHand, reserved: beforeReview.reserved } : null
    const reviewed = await app.orders.startPaymentReview({ tenantId: 'tenant-mg', paymentId: proof.paymentId, proofId: proof.id, actor: tenantOwner })
    expect(reviewed.payment.status).toBe('UNDER_REVIEW')
    expect(reviewed.proof.status).toBe('UNDER_REVIEW')
    const paid = await app.orders.approvePayment({ tenantId: 'tenant-mg', paymentId: proof.paymentId, proofId: proof.id, idempotencyKey: 'approve-1', actor: tenantOwner })
    const after = await app.orderRepositories.commerce.getPosition('tenant-mg', 'mg-stock-1')
    expect(paid.status).toBe('PAID')
    expect(beforeReviewSnapshot).toEqual({ onHand: 10, reserved: 4 })
    expect(after).toMatchObject({ onHand: 9, reserved: 3 })
  })

  it('OPERATOR cannot approve payment', async () => {
    const app = setup()
    await expect(app.orders.approvePayment({ tenantId: 'tenant-mg', paymentId: 'x', proofId: 'y', idempotencyKey: 'nope', actor: operator })).rejects.toThrow()
  })

  it('AUTOMATION cannot approve payment', async () => {
    const app = setup()
    await expect(app.orders.approvePayment({ tenantId: 'tenant-mg', paymentId: 'x', proofId: 'y', idempotencyKey: 'nope-auto', actor: automation })).rejects.toThrow()
  })

  it('rejecting proof keeps reservation ACTIVE', async () => {
    const app = setup()
    const order = await createStockOrder(app)
    const proof = await app.orders.submitPaymentProof({ tenantId: 'tenant-mg', orderId: order.id, idempotencyKey: 'proof-reject', actor: operator })
    await app.orders.rejectPaymentProof({ tenantId: 'tenant-mg', paymentId: proof.paymentId, proofId: proof.id, reason: 'No coincide', idempotencyKey: 'reject-1', actor: tenantOwner })
    expect((await app.orders.getOrderDetail('tenant-mg', order.id))?.reservation?.status).toBe('ACTIVE')
  })

  it('rejected payment can receive replacement proof', async () => {
    const app = setup()
    const order = await createStockOrder(app)
    const first = await app.orders.submitPaymentProof({ tenantId: 'tenant-mg', orderId: order.id, idempotencyKey: 'proof-first', actor: operator })
    await app.orders.rejectPaymentProof({ tenantId: 'tenant-mg', paymentId: first.paymentId, proofId: first.id, reason: 'Referencia inválida', idempotencyKey: 'reject-first', actor: tenantOwner })
    const replacement = await app.orders.submitPaymentProof({ tenantId: 'tenant-mg', orderId: order.id, idempotencyKey: 'proof-second', actor: operator })
    expect(replacement.status).toBe('RECEIVED')
  })
})

describe('H3 cancellation, expiration, fulfillment and dashboard', () => {
  it('cancellation releases ACTIVE reservation exactly once', async () => {
    const app = setup()
    const order = await createStockOrder(app)
    const reserved = await app.orderRepositories.commerce.getPosition('tenant-mg', 'mg-stock-1')
    const reservedCount = reserved?.reserved
    const cancelled = await app.orders.cancelOrder({ tenantId: 'tenant-mg', orderId: order.id, reason: 'Cliente desistió', idempotencyKey: 'cancel-1', actor: tenantOwner })
    const released = await app.orderRepositories.commerce.getPosition('tenant-mg', 'mg-stock-1')
    const releasedCount = released?.reserved
    const retry = await app.orders.cancelOrder({ tenantId: 'tenant-mg', orderId: order.id, reason: 'Cliente desistió', idempotencyKey: 'cancel-1', actor: tenantOwner })
    const afterRetry = await app.orderRepositories.commerce.getPosition('tenant-mg', 'mg-stock-1')
    const afterRetryCount = afterRetry?.reserved
    expect(reservedCount).toBe(4)
    expect(releasedCount).toBe(3)
    expect(afterRetryCount).toBe(3)
    expect(retry.id).toBe(cancelled.id)
  })

  it('expiration releases ACTIVE reservation and repeated call does not double release', async () => {
    const app = setup()
    const order = await createStockOrder(app)
    const detail = await app.orders.getOrderDetail('tenant-mg', order.id)
    expect(detail?.reservation).not.toBeNull()
    now = '2026-10-02T12:00:00.000Z'
    const expired = await app.orders.expireInventoryReservation('tenant-mg', detail!.reservation!.id, tenantOwner)
    const afterFirst = await app.orderRepositories.commerce.getPosition('tenant-mg', 'mg-stock-1')
    const repeated = await app.orders.expireInventoryReservation('tenant-mg', detail!.reservation!.id, tenantOwner)
    const afterSecond = await app.orderRepositories.commerce.getPosition('tenant-mg', 'mg-stock-1')
    expect(expired.status).toBe('EXPIRED')
    expect(repeated.status).toBe('EXPIRED')
    expect(afterSecond?.reserved).toBe(afterFirst?.reserved)
  })

  it('dashboard uses managed revenue base and snapshot management fees', async () => {
    const app = setup()
    const before = await app.orders.dashboard('tenant-mg')
    await createStockOrder(app, 'dashboard-order', { shippingCents: 5_000, taxCents: 4_000 })
    const after = await app.orders.dashboard('tenant-mg')
    expect(after.managedRevenueBaseCents - before.managedRevenueBaseCents).toBe(10_000)
    expect(after.managementFeesCents - before.managementFeesCents).toBe(500)
  })
})
