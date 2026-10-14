import { resolveChannelSender } from './channelSenderRegistry.js'

const blocked = code => ({ status: 'BLOCKED', code })
const id = value => typeof value === 'string' && value.trim() && value.length <= 512 ? value.trim() : ''
const MAX_MESSAGE_LENGTH = Object.freeze({ WHATSAPP: 4096, INSTAGRAM: 1000, FACEBOOK: 2000, TIKTOK: 6000 })

function windowOpen(lastInboundAt, now, hours) {
  const inbound = Date.parse(lastInboundAt || '')
  const elapsed = now - inbound
  return Number.isFinite(inbound) && elapsed >= -300000 && elapsed < hours * 60 * 60 * 1000
}

async function postJson(fetchImplementation, url, token, payload, headers = {}) {
  const response = await fetchImplementation(url, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) return response.status >= 500
    ? { status: 'UNKNOWN', code: 'PROVIDER_SERVER_ERROR' }
    : { status: 'FAILED', code: `PROVIDER_REJECTED_${response.status}` }
  const providerMessageId = body?.messages?.[0]?.id ?? body?.message_id
  return typeof providerMessageId === 'string' && providerMessageId
    ? { status: 'SENT', providerMessageId }
    : { status: 'UNKNOWN', code: 'PROVIDER_ACK_MISSING_ID' }
}

/** Meta Cloud API transport for WhatsApp, Messenger, and Messenger API for Instagram. */
export function createChannelOutboxTransport({ environment = process.env, fetchImplementation = fetch, now = () => Date.now() } = {}) {
  return Object.freeze({
    async send(item) {
      const tenantId = id(item?.tenantId), provider = item?.provider, channel = item?.channel
      if (!tenantId || typeof item?.text !== 'string' || !item.text.trim()) return blocked('OUTBOX_PAYLOAD_INVALID')
      if (channel === 'WEB') return blocked('WEB_REPLY_RETURNED_SYNCHRONOUSLY')
      // TikTok's official portal currently requires Business Messaging API access to see
      // the send request schema. Do not guess the request or mark an attempted send.
      if (provider === 'TIKTOK' && channel === 'TIKTOK') return blocked('TIKTOK_SEND_SCHEMA_ACCESS_REQUIRED')
      const sender = resolveChannelSender(tenantId, provider, channel, environment)
      if (!sender) return blocked('CHANNEL_SENDER_NOT_CONFIGURED')
      const recipient = id(item.externalCustomerId)
      if (!recipient) return blocked('CHANNEL_RECIPIENT_MISSING')
      const maxLength = MAX_MESSAGE_LENGTH[channel]
      if (!maxLength || item.text.trim().length > maxLength) return blocked('CHANNEL_MESSAGE_LENGTH_INVALID')
      const hours = channel === 'WHATSAPP' ? 24 : 24
      if (!windowOpen(item.lastInboundAt, now(), hours)) return blocked('CUSTOMER_REPLY_WINDOW_EXPIRED')
      const token = environment[sender.accessTokenEnv]
      if (typeof token !== 'string' || !token.trim()) return blocked('CHANNEL_CREDENTIAL_NOT_CONFIGURED')

      let endpoint, payload
      if (channel === 'WHATSAPP' && provider === 'META') {
        if (!/^\d{5,30}$/.test(sender.externalChannelId) || !/^\d{8,15}$/.test(recipient)) return blocked('WHATSAPP_ID_INVALID')
        endpoint = `https://graph.facebook.com/${sender.graphVersion}/${encodeURIComponent(sender.externalChannelId)}/messages`
        payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient,
          type: 'text', text: { preview_url: false, body: item.text.trim() } }
      } else if (['INSTAGRAM', 'FACEBOOK'].includes(channel) && provider === 'META') {
        if (!/^\d{5,40}$/.test(sender.externalChannelId) || !/^\d{5,80}$/.test(recipient)) return blocked('META_MESSAGING_ID_INVALID')
        endpoint = `https://graph.facebook.com/${sender.graphVersion}/${encodeURIComponent(sender.externalChannelId)}/messages`
        payload = { recipient: { id: recipient }, messaging_type: 'RESPONSE', message: { text: item.text.trim() } }
      } else return blocked('CHANNEL_PROVIDER_NOT_SUPPORTED')

      try { return await postJson(fetchImplementation, endpoint, token, payload) }
      catch { return { status: 'UNKNOWN', code: 'PROVIDER_REQUEST_UNCERTAIN' } }
    },
  })
}
