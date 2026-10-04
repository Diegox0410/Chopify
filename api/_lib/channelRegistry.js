import { isKnownTenant } from '../../src/config/tenantRegistry.js'

const parsedChannels = () => {
  const raw = process.env.CHOPIFY_WHATSAPP_CHANNELS_JSON
  if (!raw) return []
  let value
  try { value = JSON.parse(raw) } catch { throw new Error('Invalid CHOPIFY_WHATSAPP_CHANNELS_JSON') }
  if (!Array.isArray(value)) throw new Error('Invalid CHOPIFY_WHATSAPP_CHANNELS_JSON')
  return value.map(item => {
    if (!item || typeof item !== 'object' || !isKnownTenant(item.tenantId) || typeof item.phoneNumberId !== 'string' || !item.phoneNumberId.trim() || typeof item.accessTokenEnv !== 'string' || !item.accessTokenEnv.trim()) throw new Error('Invalid WhatsApp channel configuration')
    return Object.freeze({ tenantId: item.tenantId, provider: 'META', channel: 'WHATSAPP', externalChannelId: item.phoneNumberId.trim(), accessTokenEnv: item.accessTokenEnv.trim(), status: item.status === 'ACTIVE' ? 'ACTIVE' : 'CONFIGURED' })
  })
}

export function whatsappChannels() {
  const configured = parsedChannels()
  if (configured.length > 0) return configured
  const legacyId = process.env.FLOES_WHATSAPP_PHONE_NUMBER_ID?.trim()
  if (!legacyId) return []
  return [Object.freeze({ tenantId: 'tenant-floes', provider: 'META', channel: 'WHATSAPP', externalChannelId: legacyId, accessTokenEnv: 'META_WHATSAPP_ACCESS_TOKEN', status: 'CONFIGURED' })]
}

export function resolveWhatsAppChannel(phoneNumberId) {
  const matches = whatsappChannels().filter(channel => channel.externalChannelId === phoneNumberId)
  if (matches.length > 1) throw new Error('Duplicate WhatsApp external channel configuration')
  return matches[0] ?? null
}

export function configuredWhatsAppTenants() { return [...new Set(whatsappChannels().map(channel => channel.tenantId))] }
