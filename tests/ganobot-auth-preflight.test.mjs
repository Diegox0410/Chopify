import test from 'node:test'
import assert from 'node:assert/strict'
import { createGanoBotAuthPreflightHandler } from '../api/_lib/ganobot-auth-preflight.js'

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value },
    end(value = '') { this.body = value },
  }
}

const productionEnv = {
  VERCEL_ENV: 'production',
  CHOPIFY_PRODUCTION_PREFLIGHT_TOKEN: 'diagnostic-test-token',
  CHOPIFY_OPERATIONS_API_TOKEN: 'operations-test-token',
  GANOBOT_LIVE_URL: 'https://gano-bot-web.vercel.app/api/live',
  GANOBOT_LIVE_BEARER_TOKEN: 'server-only-test-bearer',
}

test('requires the configured diagnostic service token before contacting GanoBot', async () => {
  let calls = 0
  const handler = createGanoBotAuthPreflightHandler({
    environment: productionEnv,
    fetchImpl: async () => { calls += 1 },
  })
  const res = response()
  await handler({ method: 'POST', headers: { authorization: 'Bearer incorrect' } }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(calls, 0)
  assert.deepEqual(JSON.parse(res.body), { result: 'FAIL', cause: 'UNAUTHORIZED' })
})

test('accepts the existing operations service token without exposing it', async () => {
  let calls = 0
  const handler = createGanoBotAuthPreflightHandler({
    environment: productionEnv,
    fetchImpl: async () => {
      calls += 1
      return new Response(JSON.stringify({ error: { code: 'INVALID_LIVE_REQUEST' } }), { status: 400 })
    },
  })
  const res = response()
  await handler({ method: 'POST', headers: { authorization: 'Bearer operations-test-token' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(calls, 1)
  assert.equal(res.body.includes('operations-test-token'), false)
})

test('authenticated invalid request proves bearer and route without starting a conversation', async () => {
  let request
  const handler = createGanoBotAuthPreflightHandler({
    environment: productionEnv,
    makeCorrelationId: () => 'corr-test-123',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options, body: JSON.parse(options.body) }
      return new Response(JSON.stringify({ error: { code: 'INVALID_LIVE_REQUEST' } }), { status: 400 })
    },
  })
  const res = response()
  await handler({ method: 'POST', headers: { authorization: 'Bearer diagnostic-test-token' } }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), { result: 'PASS', correlationId: 'corr-test-123' })
  assert.equal(request.url, 'https://gano-bot-web.vercel.app/api/live')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.redirect, 'manual')
  assert.equal(request.options.headers.Authorization, 'Bearer server-only-test-bearer')
  assert.deepEqual(request.body, { tenantId: 'tenant-floes', channel: 'WHATSAPP' })
  assert.equal('customer' in request.body, false)
  assert.equal('providerMessageId' in request.body, false)
  assert.equal('text' in request.body, false)
})

test('maps an upstream 401 to credential rejected without echoing upstream data', async () => {
  const handler = createGanoBotAuthPreflightHandler({
    environment: productionEnv,
    makeCorrelationId: () => 'corr-401',
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', token: 'do-not-echo' } }), { status: 401 }),
  })
  const res = response()
  await handler({ method: 'POST', headers: { authorization: 'Bearer diagnostic-test-token' } }, res)
  assert.equal(res.statusCode, 502)
  assert.deepEqual(JSON.parse(res.body), { result: 'FAIL', cause: 'CREDENTIAL_REJECTED', correlationId: 'corr-401' })
  assert.equal(res.body.includes('do-not-echo'), false)
})

test('blocks non-production destinations and does not accept redirects', async () => {
  let calls = 0
  const handler = createGanoBotAuthPreflightHandler({
    environment: { ...productionEnv, GANOBOT_LIVE_URL: 'https://example.com/api/live' },
    fetchImpl: async () => { calls += 1 },
  })
  const res = response()
  await handler({ method: 'POST', headers: { authorization: 'Bearer diagnostic-test-token' } }, res)
  assert.equal(res.statusCode, 503)
  assert.deepEqual(JSON.parse(res.body).cause, 'DESTINATION_INVALID')
  assert.equal(calls, 0)
})

test('allows only POST', async () => {
  let calls = 0
  const handler = createGanoBotAuthPreflightHandler({
    environment: productionEnv,
    fetchImpl: async () => { calls += 1 },
  })
  const res = response()
  await handler({ method: 'GET', headers: { authorization: 'Bearer diagnostic-test-token' } }, res)
  assert.equal(res.statusCode, 405)
  assert.equal(calls, 0)
})

