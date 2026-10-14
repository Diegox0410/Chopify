import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeOwnerService, bearerValue } from '../api/_lib/ownerServiceAuth.js'

const env = { VERCEL_ENV: 'production', CHOPIFY_OWNER_API_TOKEN_FLOES: 'local-test-owner-credential', CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES: 'different-preview-test-credential' }
const request = (authorization, tenantId = 'tenant-floes') => ({ headers: { authorization, 'x-chopify-access-scope': 'owner', 'x-chopify-tenant-id': tenantId } })

test('Owner service credential is canonical Bearer and pinned to its tenant and environment', () => {
  assert.equal(authorizeOwnerService(request('Bearer local-test-owner-credential'), env).ok, true)
  assert.equal(authorizeOwnerService(request('Bearer different-preview-test-credential'), env).status, 401)
  assert.equal(authorizeOwnerService(request('Bearer local-test-owner-credential', 'tenant-mg'), env).status, 401)
  assert.equal(authorizeOwnerService(request('Bearer local-test-owner-credential', 'another-tenant'), env).status, 403)
  for (const value of ['', 'local-test-owner-credential', 'Bearer', 'Bearer local-test-owner-credential extra', 'Basic local-test-owner-credential']) {
    assert.equal(authorizeOwnerService(request(value), env).status, 401)
  }
})
test('Owner service parser neither exposes nor normalizes the configured secret', () => {
  assert.equal(bearerValue({ Authorization: 'bearer local-test-owner-credential' }), 'local-test-owner-credential')
  assert.equal(authorizeOwnerService(request('Bearer local-test-owner-credential'), { ...env, CHOPIFY_OWNER_API_TOKEN_FLOES: 'local-test-owner-credential\n' }).status, 401)
  assert.equal(authorizeOwnerService({ headers: {} }, env), null)
})
