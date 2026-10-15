import assert from 'node:assert/strict'
import test from 'node:test'
import { createChannelOutboxTransport } from '../api/_lib/channelOutboxTransport.js'
import { createChannelOutboxWorkerHandler } from '../api/channel-outbox-worker.js'

const sender = (channel, externalChannelId = '123456789') => ({ tenantId: 'tenant-floes', provider: 'META', channel,
  externalChannelId, accessTokenEnv: 'META_TEST_TOKEN', status: 'ACTIVE', graphVersion: 'v23.0' })
const environment = entries => ({
  CHOPIFY_CHANNEL_SENDERS_JSON: JSON.stringify(entries), META_TEST_TOKEN: 'local-fake-token', META_GRAPH_VERSION: 'v23.0',
})
const recent = new Date(Date.now() - 30_000).toISOString()

test('Meta WhatsApp transport targets the configured phone number and returns the provider message id', async () => {
  const calls = []
  const transport = createChannelOutboxTransport({ environment: environment([sender('WHATSAPP')]), fetchImplementation: async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.fake-1' }] }), { status: 200 })
  } })
  const result = await transport.send({ tenantId: 'tenant-floes', provider: 'META', channel: 'WHATSAPP',
    externalCustomerId: '593999123456', lastInboundAt: recent, text: 'Hola', outboxId: 'out-1' })
  assert.deepEqual(result, { status: 'SENT', providerMessageId: 'wamid.fake-1' })
  assert.match(calls[0].url, /123456789\/messages$/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer local-fake-token')
  assert.deepEqual(JSON.parse(calls[0].init.body), { messaging_product: 'whatsapp', recipient_type: 'individual',
    to: '593999123456', type: 'text', text: { preview_url: false, body: 'Hola' } })
})

test('Meta Instagram and Facebook use the configured account and external customer identity', async t => {
  for (const channel of ['INSTAGRAM', 'FACEBOOK']) await t.test(channel, async () => {
    const calls = []
    const transport = createChannelOutboxTransport({ environment: environment([sender(channel, '1122334455')]), fetchImplementation: async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ recipient_id: '5566778899', message_id: `meta-${channel.toLowerCase()}-1` }), { status: 200 })
    } })
    const result = await transport.send({ tenantId: 'tenant-floes', provider: 'META', channel,
      externalCustomerId: '5566778899', lastInboundAt: recent, text: 'Hola Meta' })
    assert.deepEqual(result, { status: 'SENT', providerMessageId: `meta-${channel.toLowerCase()}-1` })
    assert.match(calls[0].url, /1122334455\/messages$/)
    assert.deepEqual(JSON.parse(calls[0].init.body), { recipient: { id: '5566778899' }, messaging_type: 'RESPONSE', message: { text: 'Hola Meta' } })
  })
})

test('transport blocks expired windows, missing credentials, WEB push, and unapproved TikTok schema without a request', async () => {
  let requests = 0
  const fetchImplementation = async () => { requests++; throw new Error('must not issue provider call') }
  const transport = createChannelOutboxTransport({ environment: environment([sender('WHATSAPP'),
    { ...sender('INSTAGRAM', '1122334455'), status: 'DISABLED' }]), fetchImplementation })
  const base = { tenantId: 'tenant-floes', externalCustomerId: '593999123456', text: 'Hola' }
  assert.deepEqual(await transport.send({ ...base, provider: 'META', channel: 'WHATSAPP', lastInboundAt: '2026-10-11T00:00:00.000Z' }),
    { status: 'BLOCKED', code: 'CUSTOMER_REPLY_WINDOW_EXPIRED' })
  assert.deepEqual(await transport.send({ ...base, provider: 'META', channel: 'INSTAGRAM', lastInboundAt: recent }),
    { status: 'BLOCKED', code: 'CHANNEL_SENDER_NOT_CONFIGURED' })
  assert.deepEqual(await transport.send({ ...base, provider: 'META', channel: 'WEB', lastInboundAt: recent }),
    { status: 'BLOCKED', code: 'WEB_REPLY_RETURNED_SYNCHRONOUSLY' })
  assert.deepEqual(await transport.send({ ...base, provider: 'TIKTOK', channel: 'TIKTOK', lastInboundAt: recent }),
    { status: 'BLOCKED', code: 'TIKTOK_SEND_SCHEMA_ACCESS_REQUIRED' })
  assert.equal(requests, 0)
})

test('provider 4xx is terminal FAILED and provider 5xx is ambiguous UNKNOWN', async t => {
  for (const [status, expected] of [[400, 'FAILED'], [503, 'UNKNOWN']]) await t.test(String(status), async () => {
    const transport = createChannelOutboxTransport({ environment: environment([sender('WHATSAPP')]),
      fetchImplementation: async () => new Response(JSON.stringify({ error: { message: 'private provider detail' } }), { status }) })
    const outcome = await transport.send({ tenantId: 'tenant-floes', provider: 'META', channel: 'WHATSAPP',
      externalCustomerId: '593999123456', lastInboundAt: recent, text: 'Hola' })
    assert.deepEqual(outcome, status >= 500
      ? { status: 'UNKNOWN', code: 'PROVIDER_SERVER_ERROR' }
      : { status: 'FAILED', code: `PROVIDER_REJECTED_${status}` })
    assert.equal(outcome.status, expected)
  })
})

function invoke(handler, request) {
  let body = ''
  const response = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value }, end(value) { body = value } }
  return Promise.resolve(handler(request, response)).then(() => ({ status: response.statusCode, body: JSON.parse(body) }))
}

test('scheduled worker requires a secret, stays disabled by default, and dispatches only active configured tenants', async () => {
  const env = { ...environment([sender('WHATSAPP')]), CRON_SECRET: 'test-cron-secret', CHANNEL_OUTBOX_ENABLED: 'true' }
  const seen = []
  const handler = createChannelOutboxWorkerHandler({ environment: env,
    dispatch: async input => { seen.push(input); return [{ id: 'opaque-outbox', status: 'SENT' }] },
    createTransport: () => ({ send: async () => ({ status: 'SENT' }) }), now: () => 123 })
  assert.equal((await invoke(handler, { method: 'GET', headers: {} })).status, 401)
  assert.equal(seen.length, 0)
  const response = await invoke(handler, { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, processed: 1, statuses: { SENT: 1 } })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].tenantId, 'tenant-floes')
  assert.equal(seen[0].limit, 5)
  assert.equal(seen[0].workerId.startsWith('cron-'), true)
})

test('scheduled worker refuses dispatch until explicitly enabled', async () => {
  let dispatches = 0
  const handler = createChannelOutboxWorkerHandler({ environment: { ...environment([sender('WHATSAPP')]), CRON_SECRET: 'test-cron-secret' },
    dispatch: async () => { dispatches++; return [] } })
  const response = await invoke(handler, { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
  assert.equal(response.status, 503)
  assert.equal(response.body.error, 'OUTBOX_WORKER_DISABLED')
  assert.equal(dispatches, 0)
})

test('manual synthetic worker is authenticated, Preview-only, and never initializes a real transport', async () => {
  const env = { VERCEL_ENV: 'preview', CHANNEL_OUTBOX_TRANSPORT: 'synthetic', CHANNEL_OUTBOX_ENABLED: 'true', CRON_SECRET: 'test-cron-secret' }
  const seen = []
  const handler = createChannelOutboxWorkerHandler({ environment: env,
    dispatch: async input => { seen.push(input); return [{ id: 'synthetic-row', status: (await input.transport({ outboxId: 'synthetic-row' })).status }] },
    createTransport: () => { throw new Error('real transport must not be created') },
    legacyTenants: () => { throw new Error('legacy provider dispatch must be skipped') },
  })
  assert.equal((await invoke(handler, { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })).status, 405)
  assert.equal((await invoke(handler, { method: 'POST', headers: {} })).status, 401)
  const response = await invoke(handler, { method: 'POST', headers: { authorization: 'Bearer test-cron-secret' } })
  assert.equal(response.status, 200)
  assert.equal(response.body.transport, 'SYNTHETIC_PREVIEW')
  assert.deepEqual(response.body.statuses, { SENT: 1 })
  assert.equal(seen.length, 1)
  const productionGuard = createChannelOutboxWorkerHandler({ environment: { ...env, VERCEL_ENV: 'production' }, dispatch: async () => { throw new Error('must not dispatch') } })
  assert.equal((await invoke(productionGuard, { method: 'POST', headers: { authorization: 'Bearer test-cron-secret' } })).status, 403)
})

test('scheduler sends legacy WhatsApp rows only for explicitly active tenant channels', async () => {
  const env = { CRON_SECRET: 'test-cron-secret', CHANNEL_OUTBOX_ENABLED: 'true',
    CHOPIFY_WHATSAPP_CHANNELS_JSON: JSON.stringify([{ tenantId: 'tenant-floes', phoneNumberId: '123456789', accessTokenEnv: 'META_TEST_TOKEN', status: 'ACTIVE' }]) }
  const queries = [], sent = []
  const handler = createChannelOutboxWorkerHandler({ environment: env, dispatch: async () => [],
    legacyTenants: (_environment, options) => options.activeOnly ? ['tenant-floes'] : [],
    async listLegacyOutbox(limit, tenantId) {
      queries.push({ limit, tenantId })
      return [{ id: 'outbound-whatsapp-1', tenantId, status: 'PENDING' }, { id: 'outbound-other-1', tenantId: 'tenant-mg', status: 'PENDING' }]
    },
    async sendLegacy(id) { sent.push(id); return { status: 'SENT' } },
    createTransport: () => ({ send: async () => ({ status: 'SENT' }) }),
  })
  const response = await invoke(handler, { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
  assert.equal(response.status, 200)
  assert.deepEqual(queries, [{ limit: 5, tenantId: 'tenant-floes' }])
  assert.deepEqual(sent, ['outbound-whatsapp-1'])
  assert.deepEqual(response.body.statuses, { SENT: 1 })
})
