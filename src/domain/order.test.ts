import { describe, expect, it } from 'vitest'
import {
  approvePayment,
  approveProof,
  calculateOrderTotals,
  cancelOrder,
  createOrderItemSnapshot,
  dispatchOrder,
  markDelivered,
  markReady,
  receivePaymentProof,
  rejectPayment,
  rejectProof,
  startPaymentReview,
  startPreparation,
} from './index'
import type { Order, Payment, PaymentProof } from './index'

const at = '2026-09-27T12:00:00.000Z'

const payment = (status: Payment['status'] = 'UNPAID'): Payment => ({
  id: 'payment-1',
  tenantId: 'tenant-mg',
  orderId: 'order-1',
  amountCents: 10_000,
  currency: 'COP',
  status,
  createdAt: at,
  updatedAt: at,
})

const proof = (status: PaymentProof['status'] = 'RECEIVED'): PaymentProof => ({
  id: 'proof-1',
  tenantId: 'tenant-mg',
  paymentId: 'payment-1',
  orderId: 'order-1',
  type: 'TRANSFER',
  status,
  submittedAt: at,
})

const paidOrder = (): Order => ({
  id: 'order-1',
  tenantId: 'tenant-mg',
  customerId: 'customer-1',
  currency: 'COP',
  items: [createOrderItemSnapshot({ productId: 'p1', productName: 'Producto', quantity: 1, unitPriceCents: 10_000 })],
  productSubtotalCents: 10_000,
  discountTotalCents: 0,
  shippingTotalCents: 0,
  taxTotalCents: 0,
  otherPassThroughCents: 0,
  grandTotalCents: 10_000,
  orderStatus: 'CONFIRMED',
  paymentStatus: 'PAID',
  fulfillmentStatus: 'UNFULFILLED',
  attributionSnapshot: { managed: true, managedBy: 'HUMAN' },
  managedSnapshot: { managed: true, managedBy: 'HUMAN', managedOrderRateBps: 500, managedRevenueBaseCents: 10_000, managementFeeCents: 500 },
  createdAt: at,
  updatedAt: at,
})

describe('H3 order snapshots and totals', () => {
  it('creates immutable-value historical line calculations', () => {
    const item = createOrderItemSnapshot({ productId: 'p1', productName: 'Producto', quantity: 2, unitPriceCents: 5_000, discountCents: 1_000 })
    expect(item).toMatchObject({ lineSubtotalCents: 10_000, discountCents: 1_000, lineTotalCents: 9_000 })
  })

  it('rejects zero quantity', () => {
    expect(() => createOrderItemSnapshot({ productId: 'p1', productName: 'Producto', quantity: 0, unitPriceCents: 100 })).toThrow('Quantity must be a positive integer')
  })

  it('rejects non-integer cents', () => {
    expect(() => createOrderItemSnapshot({ productId: 'p1', productName: 'Producto', quantity: 1, unitPriceCents: 10.5 })).toThrow()
  })

  it('rejects discount greater than subtotal', () => {
    expect(() => createOrderItemSnapshot({ productId: 'p1', productName: 'Producto', quantity: 1, unitPriceCents: 100, discountCents: 101 })).toThrow('Discount cannot exceed line subtotal')
  })

  it('includes pass-through amounts in grand total', () => {
    const item = createOrderItemSnapshot({ productId: 'p1', productName: 'Producto', quantity: 1, unitPriceCents: 10_000, discountCents: 2_000 })
    expect(calculateOrderTotals([item], { shippingCents: 600, taxCents: 400, otherPassThroughCents: 300 })).toEqual({
      productSubtotalCents: 10_000,
      discountTotalCents: 2_000,
      shippingTotalCents: 600,
      taxTotalCents: 400,
      otherPassThroughCents: 300,
      grandTotalCents: 9_300,
    })
  })
})

describe('H3 payment evidence and review', () => {
  it('receipt of proof never confirms payment', () => {
    expect(receivePaymentProof(payment(), at).status).toBe('PROOF_RECEIVED')
  })

  it('moves matching payment and proof into UNDER_REVIEW', () => {
    const result = startPaymentReview(payment('PROOF_RECEIVED'), proof(), at)
    expect(result.payment.status).toBe('UNDER_REVIEW')
    expect(result.proof.status).toBe('UNDER_REVIEW')
  })

  it('makes repeated UNDER_REVIEW transition a safe no-op', () => {
    const p = payment('UNDER_REVIEW')
    const evidence = proof('UNDER_REVIEW')
    const result = startPaymentReview(p, evidence, at)
    expect(result.payment).toBe(p)
    expect(result.proof).toBe(evidence)
  })

  it('rejects a proof linked to another payment', () => {
    expect(() => startPaymentReview(payment('PROOF_RECEIVED'), { ...proof(), paymentId: 'other' }, at)).toThrow('Proof does not belong to payment')
  })

  it('explicit approval records the confirming actor', () => {
    expect(approvePayment(payment('UNDER_REVIEW'), 'owner-1', at)).toMatchObject({ status: 'PAID', confirmedBy: 'owner-1', paidAt: at })
  })

  it('rejection remains distinct from approval', () => {
    expect(rejectPayment(payment('UNDER_REVIEW'), at).status).toBe('REJECTED')
    expect(rejectProof(proof('UNDER_REVIEW'), 'owner-1', 'No coincide', at)).toMatchObject({ status: 'REJECTED', rejectionReason: 'No coincide' })
  })

  it('approves reviewable proof explicitly', () => {
    expect(approveProof(proof('UNDER_REVIEW'), 'owner-1', at)).toMatchObject({ status: 'APPROVED', reviewedBy: 'owner-1' })
  })
})

describe('H3 cancellation and fulfillment state machines', () => {
  it('requires cancellation reason', () => {
    const order = { ...paidOrder(), paymentStatus: 'UNPAID' as const, orderStatus: 'CREATED' as const }
    expect(() => cancelOrder(order, ' ', at)).toThrow('Cancellation reason is required')
  })

  it('does not naively cancel a paid order', () => {
    expect(() => cancelOrder(paidOrder(), 'Cliente solicita', at)).toThrow('Paid or completed orders require an explicit refund/restock flow')
  })

  it('requires PAID before preparation', () => {
    expect(() => startPreparation({ ...paidOrder(), paymentStatus: 'UNPAID' }, at)).toThrow('require PAID')
  })

  it('executes paid fulfillment in strict sequence through COMPLETED', () => {
    const preparing = startPreparation(paidOrder(), at)
    const ready = markReady(preparing, at)
    const dispatched = dispatchOrder(ready, { courier: 'Courier', trackingCode: 'ABC' }, at)
    const delivered = markDelivered(dispatched, at)
    expect(preparing.fulfillmentStatus).toBe('PREPARING')
    expect(ready.fulfillmentStatus).toBe('READY')
    expect(dispatched.fulfillmentStatus).toBe('DISPATCHED')
    expect(delivered).toMatchObject({ fulfillmentStatus: 'DELIVERED', orderStatus: 'COMPLETED' })
  })
})
