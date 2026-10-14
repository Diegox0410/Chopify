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
    let senders
    try { senders = configuredChannelSenders(environment) }
    catch { return json(response, 503, { ok: false, error: 'CHANNEL_CONFIGURATION_INVALID' }) }
    let whatsappTenants
    try { whatsappTenants = legacyTenants(environment, { activeOnly: true }).filter(tenantId => tenantDefinitions[tenantId]?.status === 'ACTIVE') }
    catch { return json(response, 503, { ok: false, error: 'WHATSAPP_CONFIGURATION_INVALID' }) }
    if (!senders.length && !whatsappTenants.length) return json(response, 200, { ok: true, processed: 0, statuses: {} })
    const transport = createTransport({ environment, now })
    const outcomes = []
    const tenantIds = [...new Set(senders.map(sender => sender.tenantId))]
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
      return json(response, 200, { ok: true, processed: outcomes.length, statuses })
    } catch {
      return json(response, 503, { ok: false, error: 'OUTBOX_DISPATCH_FAILED' })
    }
  }
}

export default createChannelOutboxWorkerHandler()
