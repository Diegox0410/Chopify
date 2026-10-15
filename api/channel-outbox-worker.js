import { randomUUID, timingSafeEqual } from 'node:crypto'
import { tenantDefinitions } from '../src/config/tenantRegistry.js'
import { dispatchChannelOutboxOnce } from './_lib/conversationStore.js'
import { configuredChannelSenders } from './_lib/channelSenderRegistry.js'
import { createChannelOutboxTransport } from './_lib/channelOutboxTransport.js'
import { configuredWhatsAppTenants } from './_lib/channelRegistry.js'
import { listPendingOutbox, sendOutbound } from './_lib/live.js'

const json = (response, statusCode, body) => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}
const validSecret = (request, expected) => {
  const header = request.headers?.authorization
  const actual = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!expected || !actual || actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

/** Vercel Cron target; disabled by default until the deployment has a reviewed sender map and secret. */
export function createChannelOutboxWorkerHandler({ environment = process.env, dispatch = dispatchChannelOutboxOnce,
  createTransport = createChannelOutboxTransport, listLegacyOutbox = listPendingOutbox, sendLegacy = sendOutbound,
  legacyTenants = configuredWhatsAppTenants, now = () => Date.now() } = {}) {
  return async function channelOutboxWorkerHandler(request, response) {
    if (!['GET', 'POST'].includes(request.method)) return json(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
    const secret = environment.CRON_SECRET || environment.CHANNEL_OUTBOX_CRON_SECRET
    if (!validSecret(request, secret)) return json(response, 401, { ok: false, error: 'UNAUTHORIZED' })
    if (environment.CHANNEL_OUTBOX_ENABLED !== 'true') return json(response, 503, { ok: false, error: 'OUTBOX_WORKER_DISABLED' })
    const syntheticOnly = environment.CHANNEL_OUTBOX_TRANSPORT === 'synthetic'
    if (syntheticOnly && environment.VERCEL_ENV !== 'preview') return json(response, 403, { ok: false, error: 'SYNTHETIC_TRANSPORT_PREVIEW_ONLY' })
    if (syntheticOnly && request.method !== 'POST') return json(response, 405, { ok: false, error: 'SYNTHETIC_TRANSPORT_MANUAL_POST_ONLY' })
    let senders
    try { senders = syntheticOnly ? [] : configuredChannelSenders(environment) }
    catch { return json(response, 503, { ok: false, error: 'CHANNEL_CONFIGURATION_INVALID' }) }
    let whatsappTenants
    try { whatsappTenants = syntheticOnly ? [] : legacyTenants(environment, { activeOnly: true }).filter(tenantId => tenantDefinitions[tenantId]?.status === 'ACTIVE') }
    catch { return json(response, 503, { ok: false, error: 'WHATSAPP_CONFIGURATION_INVALID' }) }
    if (!syntheticOnly && !senders.length && !whatsappTenants.length) return json(response, 200, { ok: true, processed: 0, statuses: {} })
    const transport = syntheticOnly
      ? { async send(item) { return { status: 'SENT', providerMessageId: `synthetic-preview-${String(item?.outboxId || item?.id || randomUUID()).slice(0, 160)}` } } }
      : createTransport({ environment, now })
    const outcomes = []
    const tenantIds = (syntheticOnly ? ['tenant-floes'] : [...new Set(senders.map(sender => sender.tenantId))])
      .filter(tenantId => tenantDefinitions[tenantId]?.status === 'ACTIVE')
    try {
      for (const tenantId of tenantIds) {
        outcomes.push(...await dispatch({ tenantId, workerId: `cron-${randomUUID()}`, transport: transport.send,
          limit: 5, now: now() }))
      }
      for (const tenantId of whatsappTenants) {
        const pending = await listLegacyOutbox(5, tenantId)
        for (const item of pending.filter(row => row.tenantId === tenantId && row.status === 'PENDING')) {
          const result = await sendLegacy(item.id)
          outcomes.push({ id: item.id, status: typeof result?.status === 'string' ? result.status : 'UNKNOWN' })
        }
      }
      const statuses = outcomes.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] || 0) + 1
        return counts
      }, {})
      return json(response, 200, { ok: true, processed: outcomes.length, statuses, ...(syntheticOnly ? { transport: 'SYNTHETIC_PREVIEW' } : {}) })
    } catch {
      return json(response, 503, { ok: false, error: 'OUTBOX_DISPATCH_FAILED' })
    }
  }
}

export default createChannelOutboxWorkerHandler()
