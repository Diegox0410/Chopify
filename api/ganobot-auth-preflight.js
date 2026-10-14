import { randomUUID, timingSafeEqual } from 'node:crypto'

const EXPECTED_HOST = 'gano-bot-web.vercel.app'
const EXPECTED_PATH = '/api/live'

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

function resolveProductionTarget(value) {
  try {
    const target = new URL(value)
    if (
      target.protocol !== 'https:' ||
      target.hostname !== EXPECTED_HOST ||
      target.pathname.replace(/\/$/, '') !== EXPECTED_PATH ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    ) return null
    return target
  } catch {
    return null
  }
}

function authorized(req, expectedTokens) {
  const header = req.headers?.authorization
  if (!expectedTokens.length || typeof header !== 'string') return false
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  const supplied = Buffer.from(match[1].trim(), 'utf8')
  return expectedTokens.some((expected) => {
    const wanted = Buffer.from(expected.trim(), 'utf8')
    return supplied.length === wanted.length && timingSafeEqual(supplied, wanted)
  })
}

export function createGanoBotAuthPreflightHandler({
  environment = process.env,
  fetchImpl = fetch,
  makeCorrelationId = randomUUID,
} = {}) {
  return async function ganoBotAuthPreflightHandler(req, res) {
    if (req.method !== 'POST') {
      return json(res, 405, { result: 'FAIL', cause: 'METHOD_NOT_ALLOWED' })
    }

    const serviceTokens = [
      environment.CHOPIFY_PRODUCTION_PREFLIGHT_TOKEN,
      environment.CHOPIFY_OPERATIONS_API_TOKEN,
    ].filter((token) => typeof token === 'string' && token.trim())
    if (!authorized(req, serviceTokens)) {
      return json(res, 401, { result: 'FAIL', cause: 'UNAUTHORIZED' })
    }

    const correlationId = makeCorrelationId()
    if (environment.VERCEL_ENV !== 'production') {
      return json(res, 404, { result: 'FAIL', cause: 'PRODUCTION_ONLY', correlationId })
    }

    const target = resolveProductionTarget(environment.GANOBOT_LIVE_URL || '')
    const bearer = environment.GANOBOT_LIVE_BEARER_TOKEN?.trim()
    if (!target || !bearer) {
      return json(res, 503, {
        result: 'FAIL',
        cause: target ? 'CREDENTIAL_MISSING' : 'DESTINATION_INVALID',
        correlationId,
      })
    }

    try {
      const upstream = await fetchImpl(target, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        // Deliberately invalid after tenant/channel policy checks. GanoBot returns
        // INVALID_LIVE_REQUEST before initializing its conversation runtime.
        body: JSON.stringify({ tenantId: 'tenant-floes', channel: 'WHATSAPP' }),
      })
      const body = await upstream.json().catch(() => ({}))
      if (upstream.status === 400 && body?.error?.code === 'INVALID_LIVE_REQUEST') {
        return json(res, 200, { result: 'PASS', correlationId })
      }

      const cause = upstream.status === 401
        ? 'CREDENTIAL_REJECTED'
        : upstream.status === 404
          ? 'UPSTREAM_ROUTE_NOT_FOUND'
          : upstream.status === 403
            ? 'TENANT_NOT_ALLOWED'
            : upstream.status >= 500
              ? 'UPSTREAM_SERVICE_ERROR'
              : 'UNEXPECTED_UPSTREAM_RESPONSE'
      return json(res, 502, { result: 'FAIL', cause, correlationId })
    } catch (error) {
      const cause = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'UPSTREAM_TIMEOUT'
        : 'UPSTREAM_UNREACHABLE'
      return json(res, 502, { result: 'FAIL', cause, correlationId })
    }
  }
}

export default createGanoBotAuthPreflightHandler()
