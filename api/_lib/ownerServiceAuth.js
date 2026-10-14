import { timingSafeEqual } from 'node:crypto'

const header = (headers, name) => {
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)
  return Array.isArray(entry?.[1]) ? entry[1][0] || '' : entry?.[1] || ''
}
export function bearerValue(headers) {
  const value = header(headers, 'authorization')
  if (typeof value !== 'string' || value.length > 8192) return ''
  return /^Bearer ([^\s]+)$/i.exec(value.trim())?.[1] || ''
}
export function equalSecret(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || !supplied || !expected) return false
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Service Owner identity is fixed by the authenticated tenant header, never by request data. */
export function authorizeOwnerService(request, env = process.env) {
  if (header(request.headers, 'x-chopify-access-scope') !== 'owner') return null
  const tenantId = header(request.headers, 'x-chopify-tenant-id')
  const tokens = {
    'tenant-floes': env.VERCEL_ENV === 'preview'
      ? env.CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES ?? env.CHOPIFY_OWNER_API_TOKEN_FLOES
      : env.CHOPIFY_OWNER_API_TOKEN_FLOES,
    'tenant-mg': env.CHOPIFY_OWNER_API_TOKEN_MG,
    'tenant-dgng': env.CHOPIFY_OWNER_API_TOKEN_DGNG,
  }
  if (!Object.hasOwn(tokens, tenantId)) return { ok: false, status: 403, error: 'Tenant not allowed' }
  if (!equalSecret(bearerValue(request.headers), tokens[tenantId])) return { ok: false, status: 401, error: 'Unauthorized' }
  const actorId=header(request.headers,'x-chopify-actor-id')
  if(actorId&&!/^[A-Za-z0-9:_-]{1,128}$/.test(actorId))return {ok:false,status:403,error:'Invalid authenticated actor'}
  return { ok: true, status: 200, tenantId, identity: { uid: actorId || `service-owner:${tenantId}`, role: 'TENANT_OWNER' } }
}
