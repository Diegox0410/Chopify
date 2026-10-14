import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { conversationIdentity, conversationMetaId, recordInboundConversation, readConversation, changeConversationControl, getConversationDeliveryContext } from '../api/_lib/conversationStore.js'
import { readConversationThread, readCustomerConversationContext, messageEvent, decodeConversationCursor, encodeConversationCursor } from '../api/_lib/conversationReadModel.js'
import { createConversationHandler, authorizeConversations } from '../api/conversations.js'
import { receive, sendOutbound, recordDeliveryStatus, extractDeliveryStatuses } from '../api/_lib/live.js'
import { sendHumanReply } from '../api/_lib/conversationHumanReply.js'
import { createChannelInboundHandler } from '../api/_lib/channelInboundHandler.js'
import { createChannelOutboundHandler } from '../api/_lib/channelOutboundHandler.js'
import { authorizeChannelInbound } from '../api/_lib/channelInboundAuth.js'
import { channelConversationIdentity } from '../api/_lib/conversationStore.js'
import { liveMemoryStore } from './helpers/liveMemoryStore.mjs'

const tenantId = 'tenant-floes'
const from = '593999999999'
const conversationId = conversationIdentity(tenantId, 'WHATSAPP', from)
const inbound = (id = 'wamid.new') => ({ id, tenantId, phoneNumberId: 'phone-floes', from, name: 'Cliente', text: 'Hola, quiero ver Daniela', receivedAt: new Date().toISOString() })
const setup = async () => {
  const store = liveMemoryStore()
  await store.createDoc('in_initial', { ...inbound(), id: undefined, conversationId })
  await recordInboundConversation(inbound(), 'in_initial', store)
  return store
}
const res = () => ({ statusCode: 0, headers: {}, setHeader(key, value) { this.headers[key] = value }, end(body) { this.body = JSON.parse(body) } })
const owner = { type: 'tenant-owner', tenantId, uid: 'service-owner:tenant-floes' }

test('canonical thread identities never merge tenants or unrelated channels', () => {
  assert.notEqual(conversationId, conversationIdentity('tenant-mg', 'WHATSAPP', from))
  assert.notEqual(conversationId, conversationIdentity(tenantId, 'INSTAGRAM', from))
})
test('two operators cannot take the same thread concurrently and each change has one audit event', async () => {
  const store = await setup()
  const results = await Promise.allSettled([
    changeConversationControl(tenantId, conversationId, 'take', 'operator-a', { idempotencyKey: 'take-a-123' }, store),
    changeConversationControl(tenantId, conversationId, 'take', 'operator-b', { idempotencyKey: 'take-b-123' }, store),
  ])
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'ASSIGNED_TO_ANOTHER_OPERATOR')
  assert.equal([...store.records.keys()].filter(id => id.startsWith('event_')).length, 1)
})
test('transfer replay is idempotent; conflicting use of the same key is rejected', async () => {
  const store = await setup(); const input = { idempotencyKey: 'take-abc-123', reason: 'Consulta' }
  const first = await changeConversationControl(tenantId, conversationId, 'take', owner.uid, input, store)
  assert.deepEqual(await changeConversationControl(tenantId, conversationId, 'take', owner.uid, input, store), first)
  await assert.rejects(changeConversationControl(tenantId, conversationId, 'release', owner.uid, input, store), error => error.code === 'IDEMPOTENCY_CONFLICT')
})
test('HUMAN mode persists the new inbound and prevents any GanoBot request; release restores subsequent automation', async () => {
  const store = await setup()
  await changeConversationControl(tenantId, conversationId, 'take', owner.uid, { idempotencyKey: 'take-123456' }, store)
  let calls = 0
  const dependencies = { ...store, conversationStore: store, prepareReply: async message => { calls++; assert.equal(message.conversationId, conversationId); return { text: 'Daniela', mode: 'GANOBOT_LIVE' } } }
  assert.equal((await receive(inbound('wamid.human'), dependencies)).needsHuman, true)
  assert.equal(calls, 0)
  await changeConversationControl(tenantId, conversationId, 'release', owner.uid, { idempotencyKey: 'release-123456' }, store)
  assert.ok((await receive(inbound('wamid.released'), dependencies)).outboundId)
  assert.equal(calls, 1)
})
test('a takeover during GanoBot generation suppresses the generated outbound', async () => {
  const store = await setup()
  const result = await receive(inbound('wamid.race'), { ...store, conversationStore: store, prepareReply: async () => {
    await changeConversationControl(tenantId, conversationId, 'take', owner.uid, { idempotencyKey: 'take-during-generation' }, store)
    return { text: 'No debe enviarse', mode: 'GANOBOT_LIVE' }
  } })
  assert.equal(result.needsHuman, true)
  assert.equal([...store.records.keys()].filter(id => id.startsWith('out_')).length, 0)
})
test('a queued bot outbound is blocked after handoff before Meta receives any request', async () => {
  const store = await setup()
  await changeConversationControl(tenantId, conversationId, 'take', owner.uid, { idempotencyKey: 'take-before-send' }, store)
  await store.createDoc('out_bot', { tenantId, conversationId, phoneNumberId: 'phone-floes', to: from, status: 'PENDING', senderType: 'GANOBOT', text: 'Bot' })
  let sends = 0
  const result = await sendOutbound('out_bot', { ...store, conversationStore: store, resolveChannel: () => ({ tenantId, externalChannelId: 'phone-floes', accessTokenEnv: 'TEST_TOKEN' }), fetch: async () => { sends++; throw new Error('Unexpected send') } })
  assert.equal(result.status, 'AUTOMATION_BLOCKED_BY_HANDOFF'); assert.equal(sends, 0)
})
test('missing metadata storage fails closed and records a specific technical cause', async () => {
  const store = liveMemoryStore(); let calls = 0
  const result = await receive(inbound('wamid.storage-error'), { ...store, conversationStore: { get: async () => { throw new Error('storage unavailable') } }, prepareReply: async () => { calls++ } })
  assert.equal(result.technicalReason, 'CONVERSATION_STORAGE_UNAVAILABLE'); assert.equal(calls, 0)
})
test('closing requires a reason and new inbound does not silently reopen a closed thread', async () => {
  const store = await setup()
  await assert.rejects(changeConversationControl(tenantId, conversationId, 'close', owner.uid, { idempotencyKey: 'close-1234567' }, store), error => error.code === 'CLOSE_REASON_REQUIRED')
  await changeConversationControl(tenantId, conversationId, 'close', owner.uid, { idempotencyKey: 'close-1234567', reason: 'Consulta resuelta' }, store)
  await recordInboundConversation(inbound('wamid.closed'), 'in_closed', store)
  assert.equal((await readConversation(tenantId, conversationId, store)).mode, 'CLOSED')
})
test('CRM and thread views share message ids from the live source and read without persistence', async () => {
  const store = await setup()
  await store.createDoc('out_response', { tenantId, conversationId, inboundId: 'in_initial', senderType: 'GANOBOT', status: 'SENT', text: 'Modelo Daniela', createdAt: new Date().toISOString() })
  const context = async () => ({ customer: { id: 'customer-real', tenantId, name: 'Cliente', status: 'ACTIVE' }, identities: [{ channel: 'WHATSAPP', externalIdentifier: from }], orders: [], payments: [], activities: [] })
  const before = structuredClone([...store.records.entries()])
  const crm = await readCustomerConversationContext(tenantId, 'customer-real', {}, { ...store, commerceContext: context })
  assert.equal(crm.conversations[0].id, conversationId)
  const thread = await readConversationThread(tenantId, crm.conversations[0].id, {}, { ...store, commerceContext: context })
  assert.deepEqual(thread.timeline.map(item => item.id), ['in_initial', 'out_response'])
  assert.equal(thread.timeline[1].deliveryStatus, 'ACCEPTED')
  assert.deepEqual([...store.records.entries()], before)
})
test('receive persists an inbound and bot reply visible from the conversation API and customer CRM', async () => {
  const store = liveMemoryStore()
  const providerMessage = inbound('wamid.e2e')
  const decision = await receive(providerMessage, {
    createDoc: store.createDoc,
    updateDoc: store.updateDoc,
    conversationStore: store,
    prepareReply: async message => {
      assert.equal(message.conversationId, conversationId)
      return { text: 'Te comparto el catálogo Daniela.', customerId: 'customer-e2e', mode: 'GANOBOT_LIVE' }
    },
  })
  assert.equal(decision.needsHuman, undefined)

  const handler = createConversationHandler({
    authorize: async () => owner,
    store,
    commerceContext: async ({ tenantId: requestedTenant, customerId }) => ({
      customer: { id: customerId || 'customer-e2e', tenantId: requestedTenant, name: 'Cliente E2E' },
      identities: [{ channel: 'WHATSAPP', externalIdentifier: from }],
      orders: [], payments: [], activities: [], notes: [], opportunities: [], escalations: [], productInterests: [],
    }),
  })
  const listResponse = res()
  await handler({ method: 'GET', query: { tenantId, view: 'list' } }, listResponse)
  assert.equal(listResponse.statusCode, 200)
  assert.equal(listResponse.body.conversations[0].id, conversationId)

  const threadResponse = res()
  await handler({ method: 'GET', query: { tenantId, view: 'thread', conversationId } }, threadResponse)
  assert.equal(threadResponse.statusCode, 200)
  assert.deepEqual(threadResponse.body.timeline.map(item => item.text), [providerMessage.text, 'Te comparto el catálogo Daniela.'])

  const crmResponse = res()
  await handler({ method: 'GET', query: { tenantId, view: 'customer', customerId: 'customer-e2e' } }, crmResponse)
  assert.equal(crmResponse.statusCode, 200)
  assert.equal(crmResponse.body.customer.id, 'customer-e2e')
  assert.equal(crmResponse.body.conversations[0].id, conversationId)
  const crmThreadResponse = res()
  await handler({ method: 'GET', query: { tenantId, view: 'thread', conversationId } }, crmThreadResponse)
  assert.deepEqual(crmThreadResponse.body.timeline.map(item => item.text), [providerMessage.text, 'Te comparto el catálogo Daniela.'])
})
test('GanoBot channel intake is tenant-scoped, idempotent, and visible in conversation and CRM reads', async () => {
  const store = liveMemoryStore()
  const env = { CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES: 'floes-channel-secret', CHOPIFY_GANOBOT_INBOUND_TOKEN_MG: 'mg-channel-secret' }
  const inboundAuth = request => authorizeChannelInbound(request, env)
  const externalConversationId = 'tiktok-thread-8842'
  const conversationId = channelConversationIdentity(tenantId, 'TIKTOK', 'TIKTOK', externalConversationId)
  const providerMessageId = 'tt-message-01'
  const idempotencyKey = createHash('sha256').update(`${tenantId}:TIKTOK:TIKTOK:${providerMessageId}`).digest('hex')
  const body = {
    tenantId, channel: 'TIKTOK', provider: 'TIKTOK', providerMessageId, externalConversationId,
    externalCustomerId: 'tiktok-user-17', customer: { name: 'Cliente TikTok', email: 'cliente@example.test' },
    text: 'Quiero conocer el precio del modelo Daniela.', receivedAt: new Date().toISOString(),
    acquisitionSource: 'TIKTOK', conversationId,
  }
  let identityCalls = 0
  const intake = createChannelInboundHandler({
    authorize: inboundAuth, store,
    resolveIdentity: async input => { identityCalls++; assert.equal(input.tenantId, tenantId); return { customerId: 'customer-tiktok-17' } },
  })
  const request = (payload = body, token = 'floes-channel-secret') => ({
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey }, body: payload,
  })
  const firstResponse = res()
  await intake(request(), firstResponse)
  assert.equal(firstResponse.statusCode, 200)
  assert.deepEqual(firstResponse.body, { conversationId, customerId: 'customer-tiktok-17', duplicate: false })
  const duplicateResponse = res()
  await intake(request(), duplicateResponse)
  assert.equal(duplicateResponse.statusCode, 200)
  assert.deepEqual(duplicateResponse.body, { conversationId, customerId: 'customer-tiktok-17', duplicate: true })
  assert.equal(identityCalls, 1)
  assert.equal([...store.records.values()].filter(row => row.data.providerMessageId === providerMessageId).length, 1)

  const commerceContext = async ({ tenantId: requestedTenant, customerId, channel, externalId }) => ({
    customer: { id: customerId || 'customer-tiktok-17', tenantId: requestedTenant, name: 'Cliente TikTok', email: 'cliente@example.test', status: 'LEAD' },
    identities: [{ tenantId: requestedTenant, customerId: 'customer-tiktok-17', channel: channel || 'TIKTOK', externalIdentifier: externalId || 'tiktok-user-17' }],
    orders: [], payments: [], activities: [], notes: [], opportunities: [], escalations: [], productInterests: [],
  })
  const conversationApi = createConversationHandler({ authorize: async () => owner, store, commerceContext })
  const listResponse = res()
  await conversationApi({ method: 'GET', query: { tenantId, view: 'list' } }, listResponse)
  assert.equal(listResponse.statusCode, 200)
  assert.equal(listResponse.body.conversations.length, 1)
  assert.equal(listResponse.body.conversations[0].id, conversationId)
  assert.equal(listResponse.body.conversations[0].channel, 'TIKTOK')

  const threadResponse = res()
  await conversationApi({ method: 'GET', query: { tenantId, view: 'thread', conversationId } }, threadResponse)
  assert.equal(threadResponse.statusCode, 200)
  assert.deepEqual(threadResponse.body.timeline.map(item => item.text), [body.text])
  assert.equal(threadResponse.body.customer.id, 'customer-tiktok-17')

  const crmResponse = res()
  await conversationApi({ method: 'GET', query: { tenantId, view: 'customer', customerId: 'customer-tiktok-17' } }, crmResponse)
  assert.equal(crmResponse.statusCode, 200)
  assert.equal(crmResponse.body.customer.name, 'Cliente TikTok')
  assert.equal(crmResponse.body.conversations[0].id, conversationId)

  const crossTenantResponse = res()
  const crossTenantBody = { ...body, tenantId: 'tenant-mg', conversationId: channelConversationIdentity('tenant-mg', 'TIKTOK', 'TIKTOK', externalConversationId) }
  await intake(request(crossTenantBody), crossTenantResponse)
  assert.equal(crossTenantResponse.statusCode, 403)
  assert.equal(identityCalls, 1)
  assert.equal([...store.records.values()].filter(row => row.data.tenantId === 'tenant-mg').length, 0)

  const conflictResponse = res()
  await intake(request({ ...body, text: 'Mensaje cambiado con la misma ID.' }), conflictResponse)
  assert.equal(conflictResponse.statusCode, 409)
  assert.equal(conflictResponse.body.error, 'IDEMPOTENCY_CONFLICT')
})
test('GanoBot channel intake accepts a customer identity with no contact attributes', async () => {
  const store = liveMemoryStore()
  const providerMessageId = 'web-message-no-contact'
  const conversationId = channelConversationIdentity(tenantId, 'WEB', 'WEB', 'web-session-108')
  const idempotencyKey = createHash('sha256').update(`${tenantId}:WEB:WEB:${providerMessageId}`).digest('hex')
  const body = {
    tenantId, channel: 'WEB', provider: 'WEB', providerMessageId, externalConversationId: 'web-session-108',
    externalCustomerId: 'anonymous-session-108', text: 'Necesito ayuda con una talla.',
    receivedAt: new Date().toISOString(), conversationId,
  }
  const intake = createChannelInboundHandler({
    authorize: async () => ({ tenantId, uid: 'ganobot-channel:tenant-floes' }), store,
    resolveIdentity: async input => { assert.deepEqual(input.customer, {}); return { customerId: 'customer-web-108' } },
  })
  const response = res()
  await intake({ method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body }, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.customerId, 'customer-web-108')
})
test('GanoBot outbound is idempotently recorded in Owner and CRM history without delivery or unread changes', async () => {
  const store = liveMemoryStore()
  const externalConversationId = 'instagram-thread-outbound'
  const conversationId = channelConversationIdentity(tenantId, 'META', 'INSTAGRAM', externalConversationId)
  const providerMessageId = 'ig-message-in-22'
  const receivedAt = new Date(Date.now() - 1000).toISOString()
  const inboundKey = createHash('sha256').update(`${tenantId}:META:INSTAGRAM:${providerMessageId}`).digest('hex')
  const intake = createChannelInboundHandler({
    authorize: async () => ({ tenantId, uid: 'ganobot-channel:tenant-floes' }), store,
    resolveIdentity: async () => ({ customerId: 'customer-ig-22' }),
  })
  const intakeResponse = res()
  await intake({ method: 'POST', headers: { 'Idempotency-Key': inboundKey }, body: {
    tenantId, channel: 'INSTAGRAM', provider: 'META', providerMessageId, externalConversationId,
    externalCustomerId: 'ig-user-22', customer: { name: 'Cliente Instagram' }, text: '¿Tienen Daniela?', receivedAt, conversationId,
  } }, intakeResponse)
  assert.equal(intakeResponse.statusCode, 200)

  const outbound = {
    tenantId, channel: 'INSTAGRAM', provider: 'META', conversationId, customerId: 'customer-ig-22',
    messageId: 'ganobot-reply-22', correlationId: 'reply-correlation-22', text: 'Sí, tenemos Daniela disponible.',
    createdAt: new Date(Date.now() + 1000).toISOString(),
  }
  const sendRecorder = createChannelOutboundHandler({
    authorize: async () => ({ tenantId, uid: 'ganobot-channel:tenant-floes' }), store,
  })
  let outboundCommitCount = 0
  const commit = store.commit
  store.commit = async writes => {
    if (writes.some(write => write.data.kind === 'CHANNEL_OUTBOX')) {
      outboundCommitCount++
      assert.deepEqual(writes.map(write => write.data.kind).sort(), ['CHANNEL_OUTBOX', 'OUTBOUND', 'THREAD'].sort())
      assert.equal(writes.find(write => write.data.kind === 'CHANNEL_OUTBOX').data.status, 'NOT_SENT')
    }
    return commit(writes)
  }
  const postOutbound = async (body = outbound) => {
    const response = res()
    const key = createHash('sha256').update(`${body.tenantId}:${body.conversationId}:${body.customerId}:${body.channel}:${body.correlationId}`).digest('hex')
    await sendRecorder({ method: 'POST', headers: { 'Idempotency-Key': key }, body }, response)
    return response
  }
  const first = await postOutbound()
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.body, {
    conversationId, customerId: 'customer-ig-22', messageId: 'ganobot-reply-22',
    outboxId: `channel_outbox_${createHash('sha256').update(`${tenantId}:${conversationId}:customer-ig-22:INSTAGRAM:reply-correlation-22`).digest('hex')}`,
    status: 'NOT_SENT', duplicate: false,
  })
  assert.equal(outboundCommitCount, 1)
  const persistedRecords = [...store.records.entries()].map(([id, row]) => ({ ...structuredClone(row.data), id }))
  const restoredStore = liveMemoryStore(persistedRecords)
  const duplicate = await createChannelOutboundHandler({
    authorize: async () => ({ tenantId, uid: 'ganobot-channel:tenant-floes' }), store: restoredStore,
  })
  const replayResponse = res()
  const duplicateKey = createHash('sha256').update(`${outbound.tenantId}:${outbound.conversationId}:${outbound.customerId}:${outbound.channel}:${outbound.correlationId}`).digest('hex')
  await duplicate({ method: 'POST', headers: { 'Idempotency-Key': duplicateKey }, body: outbound }, replayResponse)
  assert.deepEqual(replayResponse.body, { ...first.body, duplicate: true })
  assert.equal(replayResponse.statusCode, 200)
  assert.equal([...restoredStore.records.values()].filter(row => row.data.correlationId === outbound.correlationId).length, 2)
  assert.equal([...restoredStore.records.values()].filter(row => row.data.kind === 'CHANNEL_OUTBOX' && row.data.correlationId === outbound.correlationId).length, 1)
  assert.equal([...restoredStore.records.values()].filter(row => row.data.kind === 'OUTBOUND' && row.data.correlationId === outbound.correlationId).length, 1)
  const savedOutbound = [...restoredStore.records.values()].find(row => row.data.kind === 'OUTBOUND' && row.data.correlationId === outbound.correlationId).data
  assert.equal(savedOutbound.deliveryStatus, 'NOT_SENT')
  const savedOutbox = [...restoredStore.records.values()].find(row => row.data.kind === 'CHANNEL_OUTBOX' && row.data.correlationId === outbound.correlationId).data
  assert.equal(savedOutbox.tenantId, tenantId)
  assert.equal(savedOutbox.status, 'NOT_SENT')
  assert.equal((await restoredStore.get(`thread_${createHash('sha256').update(conversationId).digest('hex')}`)).data.unreadCount, '1')

  const commerceContext = async ({ tenantId: requestedTenant, customerId }) => ({
    customer: { id: customerId || 'customer-ig-22', tenantId: requestedTenant, name: 'Cliente Instagram', status: 'LEAD' },
    identities: [{ tenantId: requestedTenant, customerId: 'customer-ig-22', channel: 'INSTAGRAM', externalIdentifier: 'ig-user-22' }],
    orders: [], payments: [], activities: [], notes: [], opportunities: [], escalations: [], productInterests: [],
  })
  const conversationApi = createConversationHandler({ authorize: async () => owner, store, commerceContext })
  const listResponse = res()
  await conversationApi({ method: 'GET', query: { tenantId, view: 'list' } }, listResponse)
  assert.equal(listResponse.body.conversations[0].unreadCount, 1)
  const threadResponse = res()
  await conversationApi({ method: 'GET', query: { tenantId, view: 'thread', conversationId } }, threadResponse)
  assert.deepEqual(threadResponse.body.timeline.map(item => [item.direction, item.text]), [
    ['INBOUND', '¿Tienen Daniela?'], ['OUTBOUND', 'Sí, tenemos Daniela disponible.'],
  ])
  assert.equal(threadResponse.body.timeline[1].deliveryStatus, null)
  const crmResponse = res()
  await conversationApi({ method: 'GET', query: { tenantId, view: 'customer', customerId: 'customer-ig-22' } }, crmResponse)
  assert.equal(crmResponse.body.conversations[0].id, conversationId)

  const crossCustomer = await postOutbound({ ...outbound, customerId: 'customer-other' })
  assert.equal(crossCustomer.statusCode, 409)
  assert.equal(crossCustomer.body.error, 'CONVERSATION_CONTEXT_MISMATCH')
  const crossTenant = await postOutbound({ ...outbound, tenantId: 'tenant-mg' })
  assert.equal(crossTenant.statusCode, 403)
})
test('timeline pagination includes older messages once and rejects cursors from another tenant/thread', async () => {
  const store = await setup()
  for (let index = 1; index <= 5; index++) await store.createDoc('in_page_' + index, { tenantId, conversationId, receivedAt: `2026-10-01T00:00:0${index}.000Z`, text: String(index), from })
  const one = await readConversationThread(tenantId, conversationId, { limit: 3 }, store)
  const two = await readConversationThread(tenantId, conversationId, { limit: 3, before: one.nextCursor }, store)
  assert.equal(new Set([...one.timeline, ...two.timeline].map(item => item.id)).size, 6)
  assert.throws(() => decodeConversationCursor(one.nextCursor, 'tenant-mg', `thread:${conversationId}`), error => error.code === 'INVALID_CURSOR')
  assert.throws(() => decodeConversationCursor(encodeConversationCursor({ tenantId, scope: 'thread:other', at: '2026', id: 'in_a' }), tenantId, `thread:${conversationId}`))
})
test('private proof provider references and unapproved images never escape the read model', () => {
  const item = messageEvent({ id: 'in_private', paymentProofReference: 'meta-whatsapp://private/media/123456789', messagesJson: JSON.stringify([{ type: 'image', url: 'https://evil.test/image.jpg' }]) }, conversationId)
  assert.equal(JSON.stringify(item).includes('meta-whatsapp://'), false)
  assert.deepEqual(item.attachments, [{ type: 'PAYMENT_PROOF', private: true }])
})
test('tenant Owner cannot read another tenant; refused and unknown actions do not query/write', async () => {
  let reads = 0
  const handler = createConversationHandler({ authorize: async () => owner, store: { query: async () => { reads++; return [] }, get: async () => { reads++; return null } } })
  const response = res(); await handler({ method: 'GET', query: { tenantId: 'tenant-mg' } }, response)
  assert.equal(response.statusCode, 403); assert.equal(reads, 0)
  const response2 = res(); await handler({ method: 'POST', body: { tenantId, conversationId, action: 'arbitrary-proxy', idempotencyKey: 'some-key-12345' } }, response2)
  assert.equal(response2.statusCode, 400); assert.equal(reads, 0)
})
test('Owner service credentials require their authenticated scope and tenant', async () => {
  const previous = process.env.CHOPIFY_OWNER_API_TOKEN_FLOES
  process.env.CHOPIFY_OWNER_API_TOKEN_FLOES = 'test-owner-only'
  try {
    const access = await authorizeConversations({ headers: { authorization: 'Bearer test-owner-only', 'x-chopify-access-scope': 'owner', 'x-chopify-tenant-id': tenantId } })
    assert.equal(access.tenantId, tenantId)
    const rejected = await authorizeConversations({ headers: { authorization: 'Bearer test-owner-only', 'x-chopify-access-scope': 'owner', 'x-chopify-tenant-id': 'tenant-mg' } })
    assert.equal(rejected.type, 'denied')
  } finally { if (previous === undefined) delete process.env.CHOPIFY_OWNER_API_TOKEN_FLOES; else process.env.CHOPIFY_OWNER_API_TOKEN_FLOES = previous }
})
test('human replies use the persisted recipient, send once, and never claim physical delivery from HTTP200', async () => {
  const store = await setup()
  await changeConversationControl(tenantId, conversationId, 'take', owner.uid, { idempotencyKey: 'take-human-123' }, store)
  const oldToken = process.env.TEST_HUMAN_SEND_TOKEN; process.env.TEST_HUMAN_SEND_TOKEN = 'synthetic-test-token'
  let requests = 0
  const fakeSender = id => sendOutbound(id, { ...store, conversationStore: store, resolveChannel: () => ({ tenantId, externalChannelId: 'phone-floes', accessTokenEnv: 'TEST_HUMAN_SEND_TOKEN' }), fetch: async (_url, init) => {
    requests++; assert.equal(JSON.parse(init.body).to, from)
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.human.accepted' }] }), { status: 200 })
  } })
  try {
    const input = { text: 'Hola, soy la asesora FLOES.', idempotencyKey: 'human-reply-123' }
    const first = await sendHumanReply(tenantId, conversationId, owner.uid, input, { ...store, sendOutbound: fakeSender })
    assert.equal(first.status, 'ACCEPTED'); assert.equal(first.deliveryStatus, 'ACCEPTED')
    assert.deepEqual(await sendHumanReply(tenantId, conversationId, owner.uid, input, { ...store, sendOutbound: fakeSender }), first)
    assert.equal(requests, 1)
    await assert.rejects(sendHumanReply(tenantId, conversationId, owner.uid, { ...input, text: 'Otro texto' }, { ...store, sendOutbound: fakeSender }), error => error.code === 'IDEMPOTENCY_CONFLICT')
  } finally { if (oldToken === undefined) delete process.env.TEST_HUMAN_SEND_TOKEN; else process.env.TEST_HUMAN_SEND_TOKEN = oldToken }
})
test('free-form human and system messages outside24h are blocked without contacting Meta', async () => {
  const store = await setup()
  await store.updateDoc(conversationMetaId(conversationId), { lastInboundAt: '2020-01-01T00:00:00.000Z', mode: 'HUMAN' })
  await assert.rejects(sendHumanReply(tenantId, conversationId, owner.uid, { text: 'No enviar', idempotencyKey: 'old-window-reply' }, store), error => error.code === 'OUTSIDE_CUSTOMER_WINDOW')
  await store.createDoc('out_old_system', { tenantId, conversationId, to: from, phoneNumberId: 'phone-floes', senderType: 'SYSTEM', status: 'PENDING' })
  assert.equal((await sendOutbound('out_old_system', { ...store, conversationStore: store, resolveChannel: () => ({ tenantId }) })).status, 'OUTSIDE_CUSTOMER_WINDOW')
})
test('delivery event is tenant scoped, idempotent and monotonic; read never regresses to sent', async () => {
  const store = await setup()
  await store.createDoc('out_delivery', { tenantId, conversationId, status: 'SENT' })
  const { createHash } = await import('node:crypto')
  const providerId = 'wamid.delivery'
  await store.createDoc('provider_' + createHash('sha256').update(providerId).digest('hex'), { tenantId, conversationId, phoneNumberId: 'phone-floes', outboundId: 'out_delivery' })
  const deps = { ...store, resolveChannel: () => ({ tenantId }) }
  const status = { providerMessageId: providerId, phoneNumberId: 'phone-floes', status: 'READ', occurredAt: new Date().toISOString() }
  assert.equal((await recordDeliveryStatus(status, deps)).recorded, true)
  assert.equal((await recordDeliveryStatus(status, deps)).duplicate, true)
  await recordDeliveryStatus({ ...status, status: 'SENT' }, deps)
  assert.equal((await store.getDoc('out_delivery')).deliveryStatus, 'READ')
  assert.equal((await recordDeliveryStatus({ ...status, status: 'FAILED' }, { ...store, resolveChannel: () => ({ tenantId: 'tenant-mg' }) })).ignored, true)
})
test('status-only signed webhook payload yields delivery metadata without exposing recipient', () => {
  const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'phone-floes' }, statuses: [{ id: 'wamid.read', status: 'read', timestamp: '1791864000', recipient_id: from }] } }] }] }
  assert.equal(extractDeliveryStatuses(payload)[0].status, 'READ')
  assert.equal(JSON.stringify(extractDeliveryStatuses(payload)).includes(from), false)
})
test('delivery resolver uses the exact thread and cannot select an unrelated recent customer', async () => {
  const store = liveMemoryStore([{ id: 'in_legacy', tenantId, conversationId, channel: 'WHATSAPP', phoneNumberId: 'phone-floes', from, receivedAt: new Date().toISOString() }, { id: 'in_other', tenantId: 'tenant-mg', conversationId, from: 'another-customer', receivedAt: new Date().toISOString() }])
  assert.equal((await getConversationDeliveryContext({ tenantId, conversationId }, store)).recipient, from)
})
