import test from 'node:test'
import assert from 'node:assert/strict'
import { cachedAdminRead, clearAdminReadCacheForTests, invalidateAdminReadCache } from '../api/_lib/adminReadCache.js'

test('dashboard consumers share one in-flight tenant read and a short cached snapshot', async () => {
  clearAdminReadCacheForTests()
  let upstreamReads = 0
  const loadSnapshot = () => cachedAdminRead('command-center:tenant-floes', async () => {
    upstreamReads += 1
    await new Promise(resolve => setTimeout(resolve, 5))
    return { tenantId: 'tenant-floes', conversations: [{ id: 'conversation-1' }], alerts: [{ id: 'alert-1' }] }
  }, { ttlMs: 1_000 })
  const conversationPage = () => loadSnapshot()
  const notificationBell = async () => ({ alerts: (await loadSnapshot()).alerts })

  for (let cycle = 0; cycle < 4; cycle += 1) {
    const [conversation, notification, duplicate] = await Promise.all([
      conversationPage(), notificationBell(), conversationPage(),
    ])
    assert.equal(conversation.tenantId, 'tenant-floes')
    assert.equal(notification.alerts[0].id, 'alert-1')
    assert.equal(duplicate.conversations[0].id, 'conversation-1')
  }
  assert.equal(upstreamReads, 1)

  invalidateAdminReadCache('tenant-floes')
  await conversationPage()
  assert.equal(upstreamReads, 2)
  clearAdminReadCacheForTests()
})

test('429 responses are briefly negatively cached and can be invalidated', async () => {
  clearAdminReadCacheForTests()
  let upstreamReads = 0
  const load = () => cachedAdminRead('command-center:tenant-mg', async () => {
    upstreamReads += 1
    const error = new Error('upstream limited')
    error.upstreamStatus = 429
    throw error
  }, { failureTtlMs: 1_000 })

  await assert.rejects(load(), /upstream limited/)
  await assert.rejects(load(), /upstream limited/)
  assert.equal(upstreamReads, 1)
  invalidateAdminReadCache('tenant-mg')
  await assert.rejects(load(), /upstream limited/)
  assert.equal(upstreamReads, 2)
  clearAdminReadCacheForTests()
})
