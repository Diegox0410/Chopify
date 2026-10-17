import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { generateKeyPairSync } from 'node:crypto'
import { LiveDependencyError, queryLiveDocuments } from '../api/_lib/live.js'
import { createConversationHandler } from '../api/conversations.js'

const originalFetch = globalThis.fetch
const originalEnv = Object.fromEntries(['VERCEL_ENV', 'CHOPIFY_FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT_JSON'].map(key => [key, process.env[key]]))
process.env.VERCEL_ENV = 'preview'
process.env.CHOPIFY_FIREBASE_PROJECT_ID = 'floes-commercial-sandbox-2026'
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const previewServiceAccount = JSON.stringify({
  project_id: 'floes-commercial-sandbox-2026',
  client_email: 'preview-owner@floes-commercial-sandbox-2026.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
})
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previewServiceAccount

after(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('conversation query classifies missing Firestore composite indexes without returning provider details', async () => {
  let calls = 0
  globalThis.fetch = async url => {
    calls++
    if (String(url).includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'synthetic-access-token', expires_in: 3600 })
    return Response.json({ error: { status: 'FAILED_PRECONDITION', message: 'The query requires an index. private index URL' } }, { status: 400 })
  }
  await assert.rejects(
    queryLiveDocuments('tenant-floes', { filters: [{ field: 'kind', value: 'THREAD' }], orderBy: 'lastActivityAt', limit: 2 }),
    error => error instanceof LiveDependencyError && error.code === 'FIRESTORE_COMPOSITE_INDEX_REQUIRED' && error.httpStatus === 400 && !error.message.includes('private index URL'),
  )
  assert.equal(calls, 2)
});

test('conversation query distinguishes Firestore permission denial', async () => {
  globalThis.fetch = async () => Response.json({ error: { status: 'PERMISSION_DENIED', message: 'private auth detail' } }, { status: 403 })
  await assert.rejects(
    queryLiveDocuments('tenant-floes', { filters: [{ field: 'kind', value: 'THREAD' }], orderBy: 'lastActivityAt', limit: 2 }),
    error => error instanceof LiveDependencyError && error.code === 'FIRESTORE_PERMISSION_DENIED' && error.httpStatus === 403 && !error.message.includes('private auth detail'),
  )
});

test('conversation query distinguishes an invalid Firestore query without returning provider text', async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previewServiceAccount
  globalThis.fetch = async () => Response.json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'private query detail' } }, { status: 400 })
  await assert.rejects(
    queryLiveDocuments('tenant-floes', {}),
    error => error instanceof LiveDependencyError && error.code === 'FIRESTORE_QUERY_INVALID' && error.httpStatus === 400 && error.providerStatus === 'INVALID_ARGUMENT' && error.providerCode === 400 && error.providerBodyKind === 'ERROR_OBJECT' && !error.message.includes('private query detail'),
  )
})

test('conversation query classifies malformed or non-JSON provider 400 responses safely', async () => {
  globalThis.fetch = async () => new Response('<html>private proxy response</html>', { status: 400, headers: { 'content-type': 'text/html' } })
  await assert.rejects(
    queryLiveDocuments('tenant-floes', {}),
    error => error instanceof LiveDependencyError && error.code === 'FIRESTORE_PROVIDER_BAD_REQUEST' && error.providerBodyKind === 'NON_JSON' && !error.message.includes('private proxy response'),
  )
})

test('Preview Firestore fails closed on a service-account project mismatch before network access', async () => {
  let calls = 0
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'production-project', client_email: 'wrong@example.invalid', private_key: 'invalid' })
  globalThis.fetch = async () => { calls++; return Response.json({}) }
  await assert.rejects(queryLiveDocuments('tenant-floes', {}), error => error instanceof LiveDependencyError && error.code === 'FIRESTORE_PROJECT_MISMATCH')
  assert.equal(calls, 0)
});

test('conversation HTTP endpoint returns the safe storage code while keeping Firestore status internal', async () => {
  const handler = createConversationHandler({
    authorize: async () => ({ type: 'tenant-owner', tenantId: 'tenant-floes', uid: 'owner-test' }),
    store: { query: async () => { throw new LiveDependencyError('FIRESTORE_COMPOSITE_INDEX_REQUIRED', 'safe message', 400) } },
  })

  const response = { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value }, end(body = '') { this.body = body } }
  await handler({ method: 'GET', query: { tenantId: 'tenant-floes', view: 'list' }, headers: {} }, response)
  assert.equal(response.statusCode, 503)
  assert.deepEqual(JSON.parse(response.body), { ok: false, error: 'FIRESTORE_COMPOSITE_INDEX_REQUIRED' })
  assert.doesNotMatch(response.body, /400|private|key|https/)
});
