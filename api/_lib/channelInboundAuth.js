import { timingSafeEqual } from 'node:crypto'

const TENANT_TOKEN_ENV = Object.freeze({
  'tenant-floes': 'CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES',
  'tenant-mg': 'CHOPIFY_GANOBOT_INBOUND_TOKEN_MG',
  'tenant-dgng': 'CHOPIFY_GANOBOT_INBOUND_TOKEN_DGNG',
})

const bearer = headers => {
  const value = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'authorization')?.[1]
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? /^Bearer ([^\s]+)$/i.exec(first.trim())?.[1] || '' : ''
}

const equalSecret = (left, right) => {
  if (!left || !right) return false
  const a = Buffer.from(left); const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function authorizeChannelInbound(request, env = process.env) {
  const supplied = bearer(request.headers)
  if (!supplied) return null
  const matches = Object.entries(TENANT_TOKEN_ENV)
    .filter(([, name]) => equalSecret(supplied, env[name]))
    .map(([tenantId]) => tenantId)
  // Reused secrets make tenant attribution ambiguous, so fail closed.
  if (matches.length !== 1) return null
  return { tenantId: matches[0], uid: `ganobot-channel:${matches[0]}` }
}
