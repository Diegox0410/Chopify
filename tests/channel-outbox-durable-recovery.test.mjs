import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  channelConversationIdentity, channelInboundId, recordChannelInboundConversation, recordChannelOutboundMessage,
  claimChannelOutbox, markChannelOutboxSending, dispatchChannelOutboxOnce,
} from '../api/_lib/conversationStore.js'

// A restartable, version-preconditioned disk adapter exercises the production storage contract
// without connecting to Firebase or treating an in-memory Map as durable evidence.
function fileStore(directory) {
  const file = path.join(directory, 'firestore-records.json')
  const load = () => {
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  }
  const save = records => {
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(records), { flag: 'w' })
    renameSync(temporary, file)
  }
  return {
    async get(id) { const row = load()[id]; return row ? { id, data: row.data, version: String(row.version) } : null },
    async commit(writes) {
      const records = load()
      for (const write of writes) {
        const current = records[write.id]
        if (write.version === undefined ? current !== undefined : String(current?.version) !== String(write.version)) return false
      }
      for (const write of writes) records[write.id] = { version: (records[write.id]?.version ?? 0) + 1, data: write.data }
      save(records)
      return true
    },
    async query(tenantId, { filters = [], orderBy = '__name__', direction = 'ASCENDING', limit = 100 } = {}) {
      return Object.entries(load()).map(([id, row]) => ({ ...row.data, id }))
        .filter(row => row.tenantId === tenantId && filters.every(filter => row[filter.field] === String(filter.value)))
        .sort((a, b) => String(a[orderBy] ?? a.id).localeCompare(String(b[orderBy] ?? b.id)) * (direction === 'DESCENDING' ? -1 : 1))
        .slice(0, limit)
    },
  }
}

async function durableFixture(directory) {
  const tenantId = 'tenant-floes', provider = 'META', channel = 'INSTAGRAM'
  const externalConversationId = 'durable-ig-thread', externalCustomerId = 'durable-ig-user'
  const conversationId = channelConversationIdentity(tenantId, provider, channel, externalConversationId)
  const providerMessageId = 'durable-provider-message'
  const store = fileStore(directory)
  await recordChannelInboundConversation({ tenantId, provider, channel, providerMessageId, externalConversationId,
    externalCustomerId, receivedAt: new Date().toISOString(), text: 'Hola' }, channelInboundId(tenantId, provider, channel, providerMessageId), 'customer-durable', store)
  const outbound = await recordChannelOutboundMessage({ tenantId, provider, channel, conversationId, customerId: 'customer-durable',
    messageId: 'durable-reply', correlationId: 'durable-reply-correlation', text: 'Respuesta guardada', createdAt: new Date().toISOString() }, store)
  return { store, outbound, tenantId }
}

test('queued reply survives process restart and dispatch uses its persisted external recipient', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'chopify-outbox-'))
  try {
    const { outbound, tenantId } = await durableFixture(directory)
    assert.ok(JSON.parse(readFileSync(path.join(directory, 'firestore-records.json'), 'utf8')))
    const afterRestart = fileStore(directory)
    const queued = await afterRestart.get(outbound.outboxId)
    assert.equal(queued.data.status, 'NOT_SENT')
    assert.equal(queued.data.externalCustomerId, 'durable-ig-user')
    assert.ok(Date.parse(queued.data.lastInboundAt))
    const sends = []
    const results = await dispatchChannelOutboxOnce({ tenantId, workerId: 'disk-restart-worker', store: afterRestart,
      transport: async item => { sends.push(item); return { status: 'SENT', providerMessageId: 'durable-provider-ack' } } })
    assert.equal(results[0].status, 'SENT')
    assert.equal(sends[0].externalCustomerId, 'durable-ig-user')
    assert.equal((await fileStore(directory).get(outbound.outboxId)).data.status, 'SENT')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('expired CLAIMED lease can recover after restart; ambiguous SENDING lease reconciles without resend', async t => {
  await t.test('expired claim is reclaimed', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'chopify-claim-recovery-'))
    try {
      const { outbound, tenantId, store } = await durableFixture(directory)
      const oldNow = Date.now() - 120_000
      await claimChannelOutbox(tenantId, outbound.outboxId, 'old-process', { now: oldNow }, store)
      let sends = 0
      const result = await dispatchChannelOutboxOnce({ tenantId, workerId: 'new-process', store: fileStore(directory),
        transport: async () => { sends++; return { status: 'SENT' } } })
      assert.equal(sends, 1)
      assert.equal(result[0].status, 'SENT')
      assert.equal((await fileStore(directory).get(outbound.outboxId)).data.attempts, '2')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  await t.test('stale in-flight send becomes UNKNOWN, never resent', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'chopify-send-recovery-'))
    try {
      const { outbound, tenantId, store } = await durableFixture(directory)
      const claim = await claimChannelOutbox(tenantId, outbound.outboxId, 'crashed-process', {}, store)
      await markChannelOutboxSending(tenantId, outbound.outboxId, claim.claimId, store)
      const persisted = await store.get(outbound.outboxId)
      await store.commit([{ id: outbound.outboxId, data: { ...persisted.data, leaseUntil: new Date(Date.now() - 1_000).toISOString() }, version: persisted.version }])
      let sends = 0
      const result = await dispatchChannelOutboxOnce({ tenantId, workerId: 'replacement-process', store: fileStore(directory),
        transport: async () => { sends++; return { status: 'SENT' } } })
      assert.equal(sends, 0)
      assert.deepEqual(result, [])
      assert.equal((await fileStore(directory).get(outbound.outboxId)).data.status, 'UNKNOWN')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
