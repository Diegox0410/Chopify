import test from 'node:test'
import assert from 'node:assert/strict'
import {
  channelConversationIdentity, channelInboundId, recordChannelInboundConversation,
  recordChannelOutboundMessage, claimChannelOutbox, dispatchChannelOutboxOnce,
  listChannelOutbox, markChannelOutboxSending, changeConversationControl,
} from '../api/_lib/conversationStore.js'
import { liveMemoryStore } from './helpers/liveMemoryStore.mjs'

const tenantId = 'tenant-floes'
const provider = 'META'
const channel = 'INSTAGRAM'
const externalConversationId = 'ig-thread-outbox-tests'
const customerId = 'customer-outbox-tests'
const providerMessageId = 'ig-inbound-outbox-tests'
const conversationId = channelConversationIdentity(tenantId, provider, channel, externalConversationId)
const inId = channelInboundId(tenantId, provider, channel, providerMessageId)

async function fixture() {
  const store = liveMemoryStore()
  const receivedAt = new Date().toISOString()
  await recordChannelInboundConversation({ tenantId, provider, channel, externalConversationId,
    externalCustomerId: 'ig-external-user', providerMessageId, receivedAt, text: 'Hola' }, inId, customerId, store)
  const outbound = await recordChannelOutboundMessage({ tenantId, provider, channel, conversationId, customerId,
    messageId: 'ganobot-reply-outbox-test', correlationId: 'reply-outbox-tests', text: 'Hola, ¿cómo te ayudo?',
    createdAt: new Date().toISOString() }, store)
  return { store, outbound }
}

function restart(store) {
  return liveMemoryStore([...store.records].map(([id, row]) => ({ ...structuredClone(row.data), id })))
}

test('tenant-scoped query returns NOT_SENT and expired CLAIMED only', async () => {
  const { store, outbound } = await fixture()
  const claim = await claimChannelOutbox(tenantId, outbound.outboxId, 'worker-old', { now: Date.now() - 120000 }, store)
  assert.ok(claim)
  assert.deepEqual((await listChannelOutbox(tenantId, { now: new Date().toISOString() }, store)).map(row => row.id), [outbound.outboxId])
  assert.deepEqual(await listChannelOutbox('tenant-mg', {}, store), [])
})

test('concurrent workers acquire one atomic claim and dispatch one injected transport call', async () => {
  const { store, outbound } = await fixture()
  let sends = 0
  const dispatch = workerId => dispatchChannelOutboxOnce({ tenantId, workerId, store, transport: async request => {
    sends++
    assert.equal(request.outboxId, outbound.outboxId)
    assert.equal(request.idempotencyKey, outbound.outboxId)
    return { status: 'SENT', providerMessageId: 'provider-msg-1' }
  } })
  const results = await Promise.all([dispatch('worker-a'), dispatch('worker-b')])
  assert.equal(sends, 1)
  assert.equal(results.reduce((count, rows) => count + rows.length, 0), 1)
  assert.equal(results.flat()[0].status, 'SENT')
  const saved = await store.get(outbound.outboxId)
  assert.equal(saved.data.status, 'SENT')
  assert.equal((await store.get(outbound.outboundId)).data.deliveryStatus, 'ACCEPTED')
  const replay = await recordChannelOutboundMessage({ tenantId, provider, channel, conversationId, customerId,
    messageId: 'ganobot-reply-outbox-test', correlationId: 'reply-outbox-tests', text: 'Hola, ¿cómo te ayudo?',
    createdAt: new Date().toISOString() }, store)
  assert.equal(replay.duplicate, true)
  assert.equal(replay.status, 'SENT')
  assert.deepEqual(await dispatchChannelOutboxOnce({ tenantId, workerId: 'worker-d', store, transport: async () => { sends++; return { status: 'SENT' } } }), [])
  assert.equal(sends, 1)
})

test('expired pre-send claim survives restart and is safely reclaimed', async () => {
  const { store, outbound } = await fixture()
  const oldNow = Date.now() - 120000
  await claimChannelOutbox(tenantId, outbound.outboxId, 'worker-before-restart', { now: oldNow }, store)
  const recovered = restart(store)
  let sends = 0
  const result = await dispatchChannelOutboxOnce({ tenantId, workerId: 'worker-after-restart', store: recovered,
    transport: async () => { sends++; return { status: 'SENT', providerMessageId: 'provider-recovered' } } })
  assert.equal(sends, 1)
  assert.equal(result[0].status, 'SENT')
  assert.equal((await recovered.get(outbound.outboxId)).data.attempts, '2')
})

test('stale SENDING after restart is reconciled UNKNOWN and never blindly retried', async () => {
  const { store, outbound } = await fixture()
  const claim = await claimChannelOutbox(tenantId, outbound.outboxId, 'worker-crashed', {}, store)
  await markChannelOutboxSending(tenantId, outbound.outboxId, claim.claimId, store)
  await store.updateDoc(outbound.outboxId, { leaseUntil: new Date(Date.now() - 1000).toISOString() })
  const recovered = restart(store)
  let sends = 0
  const result = await dispatchChannelOutboxOnce({ tenantId, workerId: 'worker-restart', store: recovered,
    transport: async () => { sends++; return { status: 'SENT' } } })
  assert.equal(sends, 0)
  assert.deepEqual(result, [])
  assert.equal((await recovered.get(outbound.outboxId)).data.status, 'UNKNOWN')
})

test('uncertain transport failure becomes UNKNOWN and is not retried after restart', async () => {
  const { store, outbound } = await fixture()
  let sends = 0
  await dispatchChannelOutboxOnce({ tenantId, workerId: 'worker-ambiguous', store, transport: async () => {
    sends++
    throw new Error('connection dropped after request')
  } })
  const recovered = restart(store)
  await dispatchChannelOutboxOnce({ tenantId, workerId: 'worker-retry', store: recovered, transport: async () => { sends++; return { status: 'SENT' } } })
  assert.equal(sends, 1)
  assert.equal((await recovered.get(outbound.outboxId)).data.status, 'UNKNOWN')
})

test('human takeover after queueing blocks automated dispatch before transport', async () => {
  const { store, outbound } = await fixture()
  await changeConversationControl(tenantId, conversationId, 'take', 'owner-floes', { idempotencyKey: 'take-before-outbox-send' }, store)
  let sends = 0
  const result = await dispatchChannelOutboxOnce({ tenantId, workerId: 'worker-after-takeover', store,
    transport: async () => { sends++; return { status: 'SENT' } } })
  assert.equal(sends, 0)
  assert.deepEqual(result, [{ id: outbound.outboxId, status: 'BLOCKED' }])
  assert.equal((await store.get(outbound.outboxId)).data.failureCode, 'AUTOMATION_BLOCKED_BY_HANDOFF')
})

test('SENDING claim and human takeover serialize through the same thread version', async () => {
  const { store, outbound } = await fixture()
  const claim = await claimChannelOutbox(tenantId, outbound.outboxId, 'worker-sending', {}, store)
  await markChannelOutboxSending(tenantId, outbound.outboxId, claim.claimId, store)
  await assert.rejects(changeConversationControl(tenantId, conversationId, 'take', 'owner-floes',
    { idempotencyKey: 'take-during-channel-send' }, store), error => error.code === 'OUTBOUND_IN_PROGRESS')
})
