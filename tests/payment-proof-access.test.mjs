import test from 'node:test'
import assert from 'node:assert/strict'
import { createPaymentProofHandler, readPrivateProof } from '../api/_lib/paymentProofProxy.js'

const tenantId = 'tenant-floes'
const review = { proof: { id: 'proof-local', tenantId, orderId: 'order-local', paymentId: 'payment-local', assetReference: 'meta-whatsapp://123456789/media/987654321' }, order: { id: 'order-local', tenantId }, payment: { id: 'payment-local', orderId: 'order-local', tenantId } }
const env = { VERCEL_ENV: 'production', CHOPIFY_OWNER_API_TOKEN_FLOES: 'local-test-owner', META_WHATSAPP_ACCESS_TOKEN: 'local-test-meta', META_GRAPH_VERSION: 'v23.0' }
const channels = () => [{ tenantId, externalChannelId: '123456789', accessTokenEnv: 'META_WHATSAPP_ACCESS_TOKEN' }]
function response() { return { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value }, end(body) { this.body = body } } }
const request = target => ({ method: 'GET', headers: { authorization: 'Bearer local-test-owner', 'x-chopify-access-scope': 'owner', 'x-chopify-tenant-id': tenantId }, query: { tenantId: target, proofId: 'proof-local' } })
test('private proof accepts existing scoped Owner credential and rejects cross-tenant requests before reading', async () => {
  let reads = 0
  const fetcher = async url => String(url).startsWith('https://graph.facebook.com/')
    ? Response.json({ url: 'https://lookaside.fbsbx.com/private-proof' })
    : new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/jpeg' } })
  const handler = createPaymentProofHandler({ env, channels, runtimeClient: { async execute() { reads++; return [review] } }, fetcher })
  const ok = response(); await handler(request(tenantId), ok)
  assert.equal(ok.statusCode, 200); assert.equal(ok.headers['Cache-Control'], 'private, no-store, max-age=0'); assert.equal(reads, 1)
  const denied = response(); await handler(request('tenant-mg'), denied)
  assert.equal(denied.statusCode, 403); assert.equal(reads, 1)
  const wrong = response(); await handler({ ...request(tenantId), headers: { ...request(tenantId).headers, authorization: 'Bearer incorrect-test' } }, wrong)
  assert.equal(wrong.statusCode, 401); assert.equal(reads, 1)
})
test('proof mismatching payment/order or media channel cannot be downloaded', async () => {
  let network = 0
  const fetcher = async () => { network++; throw new Error('unexpected download') }
  const bad = { ...review, payment: { ...review.payment, orderId: 'different-order' } }
  assert.equal((await readPrivateProof({ tenantId, proofId: review.proof.id, runtimeClient: { async execute() { return [bad] } }, env, fetcher, channels })).status, 404)
  assert.equal((await readPrivateProof({ tenantId, proofId: review.proof.id, runtimeClient: { async execute() { return [review] } }, env, fetcher, channels: () => [] })).status, 503)
  assert.equal(network, 0)
})
test('proof download rejects redirects and streams beyond the maximum without exposing provider URLs', async () => {
  const data = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close() } })
  const result = await readPrivateProof({ tenantId, proofId: review.proof.id, runtimeClient: { async execute() { return [review] } }, env, channels, fetcher: async url => String(url).startsWith('https://graph.facebook.com/') ? Response.json({ url: 'https://lookaside.fbsbx.com/private-proof' }) : new Response(data, { headers: { 'content-type': 'application/pdf' } }) })
  assert.deepEqual(result, { status: 415 })
})
