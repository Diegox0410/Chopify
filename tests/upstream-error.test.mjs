import test from 'node:test'
import assert from 'node:assert/strict'
import { dependencyFailureDetails, upstreamResponseError } from '../api/_lib/upstreamError.js'

test('Firestore 429 keeps safe upstream diagnostics and retry timing', async () => {
  const response = new Response(JSON.stringify({ error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'quota exceeded: private project context',
  } }), { status: 429, headers: { 'retry-after': '20' } })
  const error = await upstreamResponseError(response, { service: 'firestore', operation: 'commerce_state_read' })
  assert.deepEqual(dependencyFailureDetails(error), {
    errorCode: 'UPSTREAM_RATE_LIMITED',
    upstreamService: 'firestore',
    upstreamOperation: 'commerce_state_read',
    upstreamStatus: 429,
    upstreamCode: 'RESOURCE_EXHAUSTED',
    retryAfterSeconds: 20,
  })
  assert.doesNotMatch(JSON.stringify(dependencyFailureDetails(error)), /private project context/)
})
