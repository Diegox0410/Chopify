import { isKnownTenant, tenantDefinitions } from '../../src/config/tenantRegistry.js'

const CHANNEL_PROVIDER = Object.freeze({
  WHATSAPP: 'META', INSTAGRAM: 'META', FACEBOOK: 'META', TIKTOK: 'TIKTOK',
})
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,99}$/
const ID = /^[A-Za-z0-9:_-]{1,256}$/

/** Server-only sender map. Secrets are referenced by environment variable name, never stored here. */
export function configuredChannelSenders(environment = process.env) {
  const raw = environment.CHOPIFY_CHANNEL_SENDERS_JSON
  if (!raw) return []
  let entries
  try { entries = JSON.parse(raw) } catch { throw new Error('INVALID_CHANNEL_SENDERS_JSON') }
  if (!Array.isArray(entries)) throw new Error('INVALID_CHANNEL_SENDERS_JSON')
  const seen = new Set()
  return entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('INVALID_CHANNEL_SENDER')
    const { tenantId, provider, channel, externalChannelId, accessTokenEnv } = entry
    const key = `${tenantId}:${provider}:${channel}`
    if (!isKnownTenant(tenantId) || tenantDefinitions[tenantId]?.status !== 'ACTIVE'
      || CHANNEL_PROVIDER[channel] !== provider || typeof externalChannelId !== 'string' || !ID.test(externalChannelId)
      || typeof accessTokenEnv !== 'string' || !ENV_NAME.test(accessTokenEnv) || !['ACTIVE', 'DISABLED'].includes(entry.status)
      || seen.has(key)) throw new Error('INVALID_CHANNEL_SENDER')
    seen.add(key)
    const graphVersion = entry.graphVersion ?? environment.META_GRAPH_VERSION ?? 'v23.0'
    if (provider === 'META' && !/^v\d+\.\d+$/.test(graphVersion)) throw new Error('INVALID_META_GRAPH_VERSION')
    if (entry.status === 'DISABLED') return null
    return Object.freeze({ tenantId, provider, channel, externalChannelId, accessTokenEnv,
      ...(provider === 'META' ? { graphVersion } : {}) })
  }).filter(Boolean)
}

export function resolveChannelSender(tenantId, provider, channel, environment = process.env) {
  return configuredChannelSenders(environment).find(item => item.tenantId === tenantId && item.provider === provider && item.channel === channel) ?? null
}
