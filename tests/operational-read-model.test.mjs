import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCommandCenterReadModel, buildNotificationsReadModel, operationalAlertId, paginateCommandCenterConversations } from '../api/_lib/commandCenterReadModel.js'
import { createPaymentProofHandler, parseMetaProofReference, readPrivateProof } from '../api/_lib/paymentProofProxy.js'

test('Command Center joins customer, selection, order, proof and operation from tenant records', () => {
  const tenantId = 'tenant-floes'
  const documents = [
    { id: 'in_1', tenantId, conversationId: 'conversation_1', from: '593999111222', text: 'Vino M', receivedAt: '2026-10-10T10:00:00.000Z', status: 'RECEIVED' },
    { id: 'thread_1', tenantId, conversationId: 'conversation_1', requiresHuman: 'true', mode: 'HUMAN' },
  ]
  const orders = [{ id: 'order_1', tenantId, customerId: 'customer_1', orderStatus: 'CREATED', paymentStatus: 'PROOF_RECEIVED', fulfillmentStatus: 'PREPARING', createdAt: '2026-10-10T10:01:00.000Z', updatedAt: '2026-10-10T10:03:00.000Z', items: [{ productName: 'Daniela', variantName: 'Vino', size: 'M' }] }]
  const customers = [{ id: 'customer_1', tenantId, name: 'Flor', phone: '593999111222' }]
  const reviews = [{ proof: { id: 'proof_1', tenantId, orderId: 'order_1', paymentId: 'payment_1', status: 'PENDING', submittedAt: '2026-10-10T10:02:00.000Z' }, payment: { id: 'payment_1', tenantId, orderId: 'order_1' }, order: orders[0] }]
  const result = buildCommandCenterReadModel({ documents, orders, customers, reviews, activities: [
    { id: 'activity_1', tenantId, orderId: 'order_1', type: 'PAYMENT_PROOF_SUBMITTED', summary: 'Comprobante recibido', occurredAt: '2026-10-10T10:02:00.000Z' },
    { id: 'activity_2', tenantId, orderId: 'order_1', type: 'FULFILLMENT_STARTED', summary: 'Pedido en preparación', occurredAt: '2026-10-10T10:03:00.000Z' },
  ], tenantId })
  assert.equal(result.conversations.length, 1)
  assert.equal(result.conversations[0].contact, 'Flor')
  assert.equal(result.conversations[0].maskedPhone, '**** 1222')
  assert.deepEqual(result.conversations[0].selection, { model: 'Daniela', color: 'Vino', size: 'M' })
  assert.equal(result.conversations[0].payment.status, 'PENDING')
  assert.equal(result.conversations[0].order.fulfillmentStatus, 'PREPARING')
  assert.deepEqual(result.candidates.map(item => item.type).sort(), ['NEEDS_HUMAN', 'PAYMENT_PENDING'])
  assert.ok(result.conversations[0].timeline.some(item => item.status === 'PAYMENT_PROOF_SUBMITTED'))
  assert.ok(result.conversations[0].timeline.some(item => item.status === 'FULFILLMENT_STARTED'))
  assert.equal(operationalAlertId(tenantId, 'PAYMENT_PENDING', 'proof_1'), operationalAlertId(tenantId, 'PAYMENT_PENDING', 'proof_1'))
  assert.notEqual(operationalAlertId(tenantId, 'PAYMENT_PENDING', 'proof_1'), operationalAlertId('tenant-mg', 'PAYMENT_PENDING', 'proof_1'))
})

test('READY alert is backed by current order state and a repeatable event key', () => {
  const result = buildCommandCenterReadModel({
    tenantId: 'tenant-floes',
    documents: [{ id: 'in_1', tenantId: 'tenant-floes', conversationId: 'conversation_1', from: '593999111222', receivedAt: '2026-10-10T10:00:00.000Z' }],
    customers: [{ id: 'customer_1', tenantId: 'tenant-floes', phone: '593999111222', name: 'Flor' }],
    orders: [{ id: 'order_1', tenantId: 'tenant-floes', customerId: 'customer_1', orderStatus: 'CREATED', paymentStatus: 'PAID', fulfillmentStatus: 'READY', createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:04:00.000Z', items: [] }],
    reviews: [],
  })
  assert.equal(result.candidates.filter(item => item.type === 'READY').length, 1)
  assert.equal(operationalAlertId('tenant-floes', 'READY', 'order_1:2026-10-10T10:04:00.000Z'), operationalAlertId('tenant-floes', 'READY', 'order_1:2026-10-10T10:04:00.000Z'))
})

test('Command Center does not join orders or customers across tenants', () => {
  const result = buildCommandCenterReadModel({
    tenantId: 'tenant-floes',
    documents: [{ id: 'in_1', tenantId: 'tenant-floes', conversationId: 'conversation_1', from: '593999111222', receivedAt: '2026-10-10T10:00:00.000Z' }],
    customers: [{ id: 'customer_1', tenantId: 'tenant-mg', phone: '593999111222', name: 'Foreign' }],
    orders: [{ id: 'order_1', tenantId: 'tenant-mg', customerId: 'customer_1', items: [{ productName: 'Foreign' }] }],
    reviews: [],
  })
  assert.equal(result.conversations[0].order, null)
  assert.equal(result.conversations[0].selection, null)
})

test('aggregated notifications retain tenant isolation and ignore non-alert documents', () => {
  const result = buildNotificationsReadModel([
    { id: 'alert_floes', tenantId: 'tenant-floes', type: 'GANOBOT_ERROR', summary: 'FLOES', read: 'false', createdAt: '2026-10-10T10:00:00.000Z' },
    { id: 'alert_mg', tenantId: 'tenant-mg', type: 'NEEDS_HUMAN', summary: 'MG', read: 'true', createdAt: '2026-10-10T10:01:00.000Z' },
    { id: 'in_mg', tenantId: 'tenant-mg', type: 'NEEDS_HUMAN', summary: 'Not an alert', read: 'false' },
    { id: 'alert_unknown', tenantId: 'tenant-unknown', type: 'NEEDS_HUMAN', read: 'false' },
  ], ['tenant-floes', 'tenant-mg'])
  assert.equal(result.alerts.length, 2)
  assert.equal(result.unreadAlertCount, 1)
  assert.deepEqual(result.alerts.map(alert => alert.tenantId), ['tenant-floes', 'tenant-mg'])
})

test('Command Center exposes 25-item cursor pages and caps each loaded timeline at 30 events', () => {
  const pages = Array.from({ length: 55 }, (_, index) => ({ id: `conversation_${index}`, lastActivityAt: new Date(2026, 0, 1, 0, index).toISOString() })).reverse()
  const snapshot = { conversations: pages, alerts: [], unreadAlertCount: 0 }
  const first = paginateCommandCenterConversations(snapshot)
  const second = paginateCommandCenterConversations(snapshot, first.nextCursor)
  const third = paginateCommandCenterConversations(snapshot, second.nextCursor)
  assert.equal(first.conversations.length, 25)
  assert.equal(second.conversations.length, 25)
  assert.equal(third.conversations.length, 5)
  assert.equal(new Set([...first.conversations, ...second.conversations, ...third.conversations].map(item => item.id)).size, 55)
  assert.throws(() => paginateCommandCenterConversations(snapshot, 'bad-cursor'), /Invalid conversation cursor/)

  const messages = Array.from({ length: 40 }, (_, index) => ({ id: `in_${index}`, tenantId: 'tenant-floes', conversationId: 'conversation_long', from: '593999111222', text: `message ${index}`, receivedAt: new Date(2026, 0, 1, 0, index).toISOString() }))
  const readModel = buildCommandCenterReadModel({ tenantId: 'tenant-floes', documents: messages, orders: [], customers: [], reviews: [] })
  assert.equal(readModel.conversations[0].messageCount, 40)
  assert.equal(readModel.conversations[0].timeline.length, 30)
})

const validReview = {
  proof: { id: 'proof_1', tenantId: 'tenant-floes', orderId: 'order_1', paymentId: 'payment_1', assetReference: 'meta-whatsapp://123456789012345/media/999999999999999' },
  payment: { id: 'payment_1', tenantId: 'tenant-floes', orderId: 'order_1' },
  order: { id: 'order_1', tenantId: 'tenant-floes' },
}

test('private proof accepts only exact Meta media references and returns a non-public byte proxy', async () => {
  assert.deepEqual(parseMetaProofReference(validReview.proof.assetReference), { phoneNumberId: '123456789012345', mediaId: '999999999999999' })
  assert.equal(parseMetaProofReference('https://attacker.invalid/file'), null)
  const calls = []
  const result = await readPrivateProof({
    tenantId: 'tenant-floes', proofId: 'proof_1',
    runtimeClient: { execute: async request => { assert.equal(request.tenantId, 'tenant-floes'); return [validReview] } },
    env: { META_GRAPH_VERSION: 'v23.0', FLOES_TOKEN: 'never-output' },
    channels: () => [{ tenantId: 'tenant-floes', externalChannelId: '123456789012345', accessTokenEnv: 'FLOES_TOKEN' }],
    fetcher: async (url, init) => {
      calls.push({ url: String(url), authorization: init.headers.Authorization })
      return calls.length === 1
        ? Response.json({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', file_size: 3 })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg', 'content-length': '3' } })
    },
  })
  assert.equal(result.status, 200)
  assert.equal(result.contentType, 'image/jpeg')
  assert.deepEqual([...result.bytes], [1, 2, 3])
  assert.equal(calls.length, 2)
  assert.ok(calls.every(item => item.authorization === 'Bearer never-output'))
  assert.equal(JSON.stringify(result).includes('never-output'), false)
})

test('private proof rejects cross-tenant relationships and unauthenticated requests before asset access', async () => {
  let fetches = 0
  const mismatched = { ...validReview, order: { ...validReview.order, tenantId: 'tenant-mg' } }
  const result = await readPrivateProof({ tenantId: 'tenant-floes', proofId: 'proof_1', runtimeClient: { execute: async () => [mismatched] }, env: {}, fetcher: async () => { fetches += 1 } })
  assert.equal(result.status, 404)
  assert.equal(fetches, 0)
  let runtimeCalls = 0
  const handler = createPaymentProofHandler({ authorize: async () => ({ ok: false, status: 401, error: 'Unauthorized' }), runtimeClient: { execute: async () => { runtimeCalls += 1; return [] } } })
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value }, end(body) { this.body = body } }
  await handler({ method: 'GET', query: { tenantId: 'tenant-floes', proofId: 'proof_1' } }, response)
  assert.equal(response.statusCode, 401)
  assert.equal(runtimeCalls, 0)
})
