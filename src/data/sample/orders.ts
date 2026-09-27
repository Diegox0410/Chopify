import type { AuditEvent, CommerceProduct, CommercialAgreement, IdempotencyRecord, InventoryPosition, InventoryReservation, Order, OrderItemSnapshot, Payment, PaymentProof } from '../../domain'

const at = (day: number, hour = 12) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`
export const sampleProducts: readonly CommerceProduct[] = [
  { id: 'mg-stock-1', tenantId: 'tenant-mg', name: 'Kit Esencial SAMPLE', priceCents: 100_00, currency: 'COP', available: 7, fulfillmentMode: 'STOCK' },
  { id: 'mg-limited', tenantId: 'tenant-mg', name: 'Edición Limitada SAMPLE', priceCents: 180_00, currency: 'COP', available: 1, fulfillmentMode: 'STOCK' },
  { id: 'dg-stock-1', tenantId: 'tenant-dgng', name: 'Pack Comercial SAMPLE', priceCents: 250_00, currency: 'COP', available: 8, fulfillmentMode: 'STOCK' },
  { id: 'dg-service', tenantId: 'tenant-dgng', name: 'Servicio Digital SAMPLE', priceCents: 90_00, currency: 'COP', available: 0, fulfillmentMode: 'SERVICE' },
  { id: 'fl-mto-1', tenantId: 'tenant-floes', name: 'Pieza a Pedido SAMPLE', priceCents: 320_00, currency: 'COP', available: 0, fulfillmentMode: 'MADE_TO_ORDER' },
  { id: 'fl-hybrid-1', tenantId: 'tenant-floes', name: 'Colección Híbrida SAMPLE', priceCents: 210_00, currency: 'COP', available: 2, fulfillmentMode: 'HYBRID' },
]
export const sampleInventory: readonly InventoryPosition[] = [
  { tenantId: 'tenant-mg', productId: 'mg-stock-1', onHand: 10, reserved: 3 }, { tenantId: 'tenant-mg', productId: 'mg-limited', onHand: 1, reserved: 0 },
  { tenantId: 'tenant-dgng', productId: 'dg-stock-1', onHand: 12, reserved: 4 }, { tenantId: 'tenant-floes', productId: 'fl-hybrid-1', onHand: 2, reserved: 0 },
]
export const sampleAgreements: readonly CommercialAgreement[] = [
  { id: 'agreement-mg', tenantId: 'tenant-mg', effectiveFrom: at(1), managedOrderRateBps: 500, publicationFeeCents: 0, annualContinuityFeeCents: 0, rulesVersion: '2026.1', createdAt: at(1) },
  { id: 'agreement-dg', tenantId: 'tenant-dgng', effectiveFrom: at(1), managedOrderRateBps: 1000, publicationFeeCents: 0, annualContinuityFeeCents: 0, rulesVersion: '2026.1', createdAt: at(1) },
  { id: 'agreement-fl', tenantId: 'tenant-floes', effectiveFrom: at(1), managedOrderRateBps: 500, publicationFeeCents: 0, annualContinuityFeeCents: 0, rulesVersion: '2026.1', createdAt: at(1) },
]
const item = (productId: string, productName: string, quantity: number, unitPriceCents: number): OrderItemSnapshot => ({ productId, productName, quantity, unitPriceCents, discountCents: 0, lineSubtotalCents: quantity * unitPriceCents, lineTotalCents: quantity * unitPriceCents })
const order = (id: string, tenantId: string, customerId: string, paymentStatus: Order['paymentStatus'], fulfillmentStatus: Order['fulfillmentStatus'], orderStatus: Order['orderStatus'], product: OrderItemSnapshot, day: number): Order => ({ id, tenantId, customerId, currency: 'COP', items: [product], productSubtotalCents: product.lineSubtotalCents, discountTotalCents: 0, shippingTotalCents: 0, taxTotalCents: 0, otherPassThroughCents: 0, grandTotalCents: product.lineTotalCents, orderStatus, paymentStatus, fulfillmentStatus, attributionSnapshot: { acquisitionSource: 'SAMPLE', conversionChannel: 'WEB', managed: true, managedBy: 'HUMAN' }, commercialAgreementSnapshot: { agreementId: tenantId === 'tenant-dgng' ? 'agreement-dg' : tenantId === 'tenant-floes' ? 'agreement-fl' : 'agreement-mg', managedOrderRateBps: tenantId === 'tenant-dgng' ? 1000 : 500, publicationFeeCents: 0, annualContinuityFeeCents: 0, rulesVersion: '2026.1', effectiveFrom: at(1), capturedAt: at(day) }, managedSnapshot: { managed: true, managedBy: 'HUMAN', managedOrderRateBps: tenantId === 'tenant-dgng' ? 1000 : 500, managedRevenueBaseCents: product.lineTotalCents, managementFeeCents: Math.round(product.lineTotalCents * (tenantId === 'tenant-dgng' ? .1 : .05)) }, createdAt: at(day), updatedAt: at(day), ...(paymentStatus === 'PAID' ? { confirmedAt: at(day) } : {}), ...(fulfillmentStatus === 'DELIVERED' ? { completedAt: at(day) } : {}) })
export const sampleOrders: readonly Order[] = [
  order('order-mg-unpaid', 'tenant-mg', 'cus-mg-1', 'UNPAID', 'UNFULFILLED', 'CREATED', item('mg-stock-1', 'Kit Esencial SAMPLE', 1, 100_00), 20),
  order('order-dg-review', 'tenant-dgng', 'cus-dg-1', 'UNDER_REVIEW', 'UNFULFILLED', 'CREATED', item('dg-stock-1', 'Pack Comercial SAMPLE', 1, 250_00), 21),
  order('order-mg-preparing', 'tenant-mg', 'cus-mg-3', 'PAID', 'PREPARING', 'CONFIRMED', item('mg-stock-1', 'Kit Esencial SAMPLE', 1, 100_00), 22),
  order('order-fl-ready', 'tenant-floes', 'cus-fl-1', 'PAID', 'READY', 'CONFIRMED', item('fl-mto-1', 'Pieza a Pedido SAMPLE', 1, 320_00), 23),
  { ...order('order-dg-dispatched', 'tenant-dgng', 'cus-dg-2', 'PAID', 'DISPATCHED', 'CONFIRMED', item('dg-stock-1', 'Pack Comercial SAMPLE', 1, 250_00), 24), fulfillmentDetails: { courier: 'Courier SAMPLE', trackingCode: 'SAMPLE-001', dispatchedAt: at(24) } },
  { ...order('order-fl-delivered', 'tenant-floes', 'cus-fl-3', 'PAID', 'DELIVERED', 'COMPLETED', item('fl-mto-1', 'Pieza a Pedido SAMPLE', 1, 320_00), 25), completedAt: at(25), fulfillmentDetails: { deliveredAt: at(25) } },
]
export const samplePayments: readonly Payment[] = sampleOrders.map((entry) => ({ id: `payment-${entry.id}`, tenantId: entry.tenantId, orderId: entry.id, amountCents: entry.grandTotalCents, currency: entry.currency, status: entry.paymentStatus, createdAt: entry.createdAt, updatedAt: entry.updatedAt, ...(entry.paymentStatus === 'PAID' ? { paidAt: entry.confirmedAt, confirmedBy: 'sample-owner' } : {}) }))
export const sampleProofs: readonly PaymentProof[] = [{ id: 'proof-dg-review', tenantId: 'tenant-dgng', paymentId: 'payment-order-dg-review', orderId: 'order-dg-review', type: 'TRANSFER', reference: 'SAMPLE-TRANSFER', assetReference: 'sample://proof/dg-review', status: 'UNDER_REVIEW', submittedAt: at(22) }]
export const sampleReservations: readonly InventoryReservation[] = [
  { id: 'reservation-mg-unpaid', tenantId: 'tenant-mg', orderId: 'order-mg-unpaid', items: [{ productId: 'mg-stock-1', quantity: 1 }], status: 'ACTIVE', createdAt: at(20), expiresAt: at(30) },
  { id: 'reservation-dg-review', tenantId: 'tenant-dgng', orderId: 'order-dg-review', items: [{ productId: 'dg-stock-1', quantity: 1 }], status: 'ACTIVE', createdAt: at(21), expiresAt: at(30) },
  { id: 'reservation-mg-preparing', tenantId: 'tenant-mg', orderId: 'order-mg-preparing', items: [{ productId: 'mg-stock-1', quantity: 1 }], status: 'COMMITTED', createdAt: at(22), committedAt: at(22) },
  { id: 'reservation-dg-dispatched', tenantId: 'tenant-dgng', orderId: 'order-dg-dispatched', items: [{ productId: 'dg-stock-1', quantity: 1 }], status: 'COMMITTED', createdAt: at(24), committedAt: at(24) },
]
export const sampleIdempotency: readonly IdempotencyRecord[] = []
export const sampleAuditEvents: readonly AuditEvent[] = []
