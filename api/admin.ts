import { createHash } from 'node:crypto'
import type { CommerceGatewayOperation } from '../src/application/commerceGateway.js'
import { PersistentCommerceRuntime, tenantDefinitions } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
import { authorizePlatformOwner } from './_lib/firebaseAuth.js'
import { configuredWhatsAppTenants, whatsappChannels } from './_lib/channelRegistry.js'
import { createDoc, getDoc, listLiveDocuments, listLiveDocumentsForTenants, sendOutbound, updateDoc } from './_lib/live.js'
import { orderStatusMessage } from './_lib/orderNotifications.js'
import { operationalAlertId, buildCommandCenterReadModel, buildNotificationsReadModel, paginateCommandCenterConversations } from './_lib/commandCenterReadModel.js'
import { cachedAdminRead, invalidateAdminReadCache } from './_lib/adminReadCache.js'
import { dependencyFailureDetails } from './_lib/upstreamError.js'
import type { CommercialActivity, Customer, Opportunity, Order, Payment, PaymentProof } from '../src/domain/index.js'

interface Request { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface Response { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }
interface Body { operation?: string; tenantId?: unknown; input?: unknown; idempotencyKey?: unknown }

const runtime = new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
const tenantIds = Object.keys(tenantDefinitions) as Array<keyof typeof tenantDefinitions>
const allowed = new Set<CommerceGatewayOperation>([
  'listProducts', 'syncFloesCatalog', 'updateProduct', 'previewCatalogImport', 'importCatalog', 'ownerDashboard', 'listOrders',
  'getOrderDetail', 'listPaymentReviews', 'approvePayment', 'rejectPaymentProof',
  'startPreparation', 'markReady', 'dispatchOrder', 'markDelivered',
  'listCustomers', 'listOpportunities', 'listExceptions', 'listOrderActivities',
])
const mutations = new Set(['syncFloesCatalog', 'updateProduct', 'importCatalog', 'approvePayment', 'rejectPaymentProof', 'startPreparation', 'markReady', 'dispatchOrder', 'markDelivered'])
const json = (res: Response, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Firestore-Quota-Safe-Mode', process.env.FIRESTORE_QUOTA_SAFE_MODE === 'true' ? 'true' : 'false')
  res.end(JSON.stringify(body))
}
const parse = (body: unknown): Body => {
  if (typeof body === 'string') return JSON.parse(body) as Body
  return body && typeof body === 'object' ? body as Body : {}
}
const configured = (names: readonly string[]) =>
  names.every(name => Boolean(process.env[name]))
    ? 'CONFIGURED'
    : 'NOT_CONFIGURED'
const whatsappConfigurationStatus = () => {
  try { return configuredWhatsAppTenants().length > 0 ? 'CONFIGURED' : 'NOT_CONFIGURED' }
  catch { return 'ERROR' }
}

async function notifyOrderStatus(tenantId: string, orderId: string, status: string) {
  const channel = whatsappChannels().find(item => item.tenantId === tenantId)
  if (!channel) return { status: 'SKIPPED', reason: 'WhatsApp channel is not configured' }
  const detail = await runtime.execute({ operation: 'getOrderDetail', tenantId, input: { orderId } }) as { order?: { id: string; conversationId?: string; fulfillmentDetails?: { trackingCode?: string } }; customer?: { phone?: string } } | undefined
  const to = String(detail?.customer?.phone || '').replace(/\D/g, '')
  if (!detail?.order || !/^\d{8,15}$/.test(to)) return { status: 'SKIPPED', reason: 'Customer WhatsApp number is unavailable' }
  const text = orderStatusMessage(status, detail.order.fulfillmentDetails?.trackingCode)
  if (!text) return { status: 'SKIPPED', reason: 'Notification template is unavailable' }
  const liveDocuments = await listLiveDocuments(tenantId, 500)
  const relatedInbound = liveDocuments.filter(item => item.id.startsWith('in_') && item.from === to).sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || ''))).at(-1)
  const key = createHash('sha256').update(`${tenantId}:${orderId}:${status}:WHATSAPP`).digest('hex')
  const outboundId = `out_${key}`
  const createdAt = new Date().toISOString()
  const created = await createDoc(outboundId, { tenantId, channel: 'WHATSAPP', provider: 'META', phoneNumberId: channel.externalChannelId, to, text, mode: 'SYSTEM', senderType: 'SYSTEM', orderId, eventStatus: status, ...(relatedInbound ? { inboundId: relatedInbound.id, conversationId: relatedInbound.conversationId || '' } : {}), status: 'PREPARED', createdAt, attempts: '0' })
  if (created || (await getDoc(outboundId))?.status === 'PREPARED') await updateDoc(outboundId, { status: 'PENDING' })
  const result = await sendOutbound(outboundId)
  return { status: result.status, eventKey: key }
}

async function dashboard(tenantId: string) {
  const [summary, orders, opportunities] = await runtime.executeMany([
    { operation: 'ownerDashboard', tenantId, input: {} },
    { operation: 'listOrders', tenantId, input: {} },
    { operation: 'listOpportunities', tenantId, input: {} },
  ]) as [unknown, Order[], Opportunity[]]
  const rows = orders as Array<{
    paymentStatus: string
    fulfillmentStatus: string
    grandTotalCents: number
    currency?: string
    managedSnapshot?: { managed: boolean; managedRevenueBaseCents: number }
  }>

  const managedPaidRows = rows.filter(row =>
    row.paymentStatus === 'PAID' &&
    row.managedSnapshot?.managed === true &&
    typeof row.currency === 'string' &&
    row.currency.length > 0
  )

  const currencies = [...new Set(managedPaidRows.map(row => row.currency as string))]

  const revenueByCurrency = Object.fromEntries(
    currencies.map(currency => [
      currency,
      managedPaidRows
        .filter(row => row.currency === currency)
        .reduce((total, row) => total + (row.managedSnapshot?.managedRevenueBaseCents ?? 0), 0),
    ])
  )

  const managedRevenue =
    currencies.length === 1
      ? {
          cents: revenueByCurrency[currencies[0]],
          currency: currencies[0],
        }
      : null
  const opportunityRows = opportunities as Array<{ status: string }>
  const closedOpportunities = opportunityRows.filter(row => row.status === 'WON' || row.status === 'LOST')
  const wonOpportunities = closedOpportunities.filter(row => row.status === 'WON').length
  return {
    tenantId,
    summary,
    paymentApproved: rows.filter(row => row.paymentStatus === 'PAID').length,
    paymentRejected: rows.filter(row => row.paymentStatus === 'REJECTED').length,
    preparing: rows.filter(row => row.fulfillmentStatus === 'PREPARING').length,
    ready: rows.filter(row => row.fulfillmentStatus === 'READY').length,
    dispatched: rows.filter(row => row.fulfillmentStatus === 'DISPATCHED').length,
    delivered: rows.filter(row => row.fulfillmentStatus === 'DELIVERED').length,
    managedRevenueCents: managedRevenue?.cents ?? null,
    managedRevenueCurrency: managedRevenue?.currency ?? null,
    revenueByCurrency,
    currencyStatus:
      currencies.length === 0
        ? 'NO_REVENUE'
        : currencies.length === 1
          ? 'SINGLE'
          : 'MIXED',
    profitCents: null,
    profitCurrency: null,
    margin: null,
    conversion: closedOpportunities.length > 0 ? wonOpportunities / closedOpportunities.length : null,
    conversionBasis: closedOpportunities.length,
  }
}

const alertTypes = new Set(['NEEDS_HUMAN', 'PAYMENT_PENDING', 'PAYMENT_REJECTED', 'READY', 'WHATSAPP_ERROR', 'GANOBOT_ERROR'])
type PaymentReview = { proof: PaymentProof; payment: Payment; order: Order; customer?: { name: string; phone: string } }
async function commandCenterSnapshot(tenantId: string) {
  const [documents, commerce] = await Promise.all([
    cachedLiveDocuments(tenantId),
    runtime.executeMany([
      { operation: 'listOrders', tenantId, input: {} },
      { operation: 'listCustomers', tenantId, input: {} },
      { operation: 'listPaymentReviews', tenantId, input: {} },
      { operation: 'listOrderActivities', tenantId, input: {} },
      { operation: 'listOpportunities', tenantId, input: {} },
    ]) as Promise<[Order[], Customer[], PaymentReview[], CommercialActivity[], Opportunity[]]>,
  ])
  const [orders, customers, reviews, activities, opportunities] = commerce
  const { conversations, candidates } = buildCommandCenterReadModel({ documents, orders, customers, reviews, activities, opportunities, tenantId })
  const existingAlerts = new Map(documents.filter(item => item.id.startsWith('alert_')).map(item => [item.id, item]))
  const alerts = []
  for (const candidate of candidates) {
    if (!alertTypes.has(candidate.type) || !candidate.sourceId) continue
    const id = operationalAlertId(tenantId, candidate.type, candidate.sourceId)
    let alert = existingAlerts.get(id)
    if (!alert) {
      const createdAt = new Date().toISOString()
      const created = await createDoc(id, { tenantId, id, type: candidate.type, idempotencyKey: `${tenantId}:${candidate.type}:${candidate.sourceId}`, sourceId: candidate.sourceId, summary: candidate.summary, href: candidate.href, read: 'false', createdAt })
      alert = created
        ? { id, tenantId, type: candidate.type, summary: candidate.summary, href: candidate.href, read: 'false', createdAt }
        : (await getDoc(id)) || undefined
    }
    if (alert) alerts.push({ id: alert.id || id, type: alert.type || candidate.type, summary: alert.summary || candidate.summary, href: alert.href || candidate.href, read: alert.read === 'true', createdAt: alert.createdAt || '' })
  }
  alerts.sort((a,b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt))
  return { conversations, alerts, unreadAlertCount: alerts.filter(alert => !alert.read).length }
}

async function cachedLiveDocuments(tenantId?: string) {
  if (tenantId) return cachedAdminRead(`live-documents:${tenantId}`, () => listLiveDocuments(tenantId, 500), { ttlMs: 20_000, failureTtlMs: 20_000 })
  return cachedAdminRead('live-documents:all', () => listLiveDocumentsForTenants(tenantIds, 1500), { ttlMs: 20_000, failureTtlMs: 20_000 })
}

async function cachedCommandCenterSnapshot(tenantId: string) {
  return cachedAdminRead(`command-center:${tenantId}`, () => commandCenterSnapshot(tenantId), { ttlMs: 10_000, failureTtlMs: 15_000 })
}

async function cachedNotificationsSnapshot() {
  return cachedAdminRead('notifications:all', async () => {
    const documents = await cachedLiveDocuments()
    return buildNotificationsReadModel(documents, tenantIds)
  }, { ttlMs: 10_000, failureTtlMs: 15_000 })
}

function readFailure(res: Response, stage: string, tenantId: string | undefined, error: unknown) {
  const details = dependencyFailureDetails(error)
  const retryAfterSeconds = details.retryAfterSeconds || (details.upstreamStatus === 429 ? 15 : undefined)
  if (retryAfterSeconds) res.setHeader('Retry-After', String(retryAfterSeconds))
  console.error(JSON.stringify({ service: 'admin', stage, ...(tenantId ? { tenantId } : {}), ...details }))
  const status = details.upstreamStatus === 429 ? 429 : 503
  return json(res, status, {
    ok: false,
    errorCode: details.errorCode,
    ...(details.upstreamService ? { upstreamService: details.upstreamService } : {}),
    ...(details.upstreamOperation ? { upstreamOperation: details.upstreamOperation } : {}),
    ...(details.upstreamStatus ? { upstreamStatus: details.upstreamStatus } : {}),
    ...(details.upstreamCode ? { upstreamCode: details.upstreamCode } : {}),
    error: status === 429 ? 'Datos temporalmente limitados por el servicio de almacenamiento.' : 'No fue posible cargar los datos administrativos.',
  })
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const auth = await authorizePlatformOwner(req)
  if (!auth.ok) return json(res, auth.status, { error: auth.error })
  let body: Body
  try { body = parse(req.body) } catch { return json(res, 400, { error: 'Invalid JSON body' }) }

  if (body.operation === 'listTenants') return json(res, 200, { ok: true, data: tenantIds.map(id => tenantDefinitions[id]) })
  if (body.operation === 'integrationStatus') return json(res, 200, { ok: true, data: {
    firebase: configured(['CHOPIFY_FIREBASE_PROJECT_ID', 'CHOPIFY_PLATFORM_OWNER_UID', 'FIREBASE_SERVICE_ACCOUNT_JSON']),
    commerce: configured(['CHOPIFY_COMMERCE_API_TOKEN']),
    whatsapp: whatsappConfigurationStatus(),
    ganobot: configured(['GANOBOT_LIVE_URL', 'GANOBOT_LIVE_BEARER_TOKEN']),
    storefront: 'UNKNOWN',
  } })
  if (body.operation === 'notificationsSnapshot') {
    try { return json(res, 200, { ok: true, data: await cachedNotificationsSnapshot() }) }
    catch (error) { return readFailure(res, 'notifications_snapshot_failed', undefined, error) }
  }
  if (body.operation === 'commandCenterSnapshot') {
    if (typeof body.tenantId !== 'string' || !(body.tenantId in tenantDefinitions)) return json(res, 403, { error: 'Tenant not allowed' })
    try {
      const snapshot = await cachedCommandCenterSnapshot(body.tenantId)
      const input = body.input && typeof body.input === 'object' ? body.input as Record<string, unknown> : {}
      return json(res, 200, { ok: true, data: paginateCommandCenterConversations(snapshot, input.cursor) })
    }
    catch (error) {
      if (error instanceof Error && error.message === 'Invalid conversation cursor') return json(res, 400, { error: error.message })
      return readFailure(res, 'command_center_snapshot_failed', body.tenantId, error)
    }
  }
  if (body.operation === 'markOperationalAlertRead') {
    if (typeof body.tenantId !== 'string' || !(body.tenantId in tenantDefinitions)) return json(res, 403, { error: 'Tenant not allowed' })
    const id = typeof (body.input as { alertId?: unknown } | undefined)?.alertId === 'string' ? (body.input as { alertId: string }).alertId : ''
    if (!/^alert_[a-f0-9]{64}$/.test(id)) return json(res, 400, { error: 'Invalid alert' })
    try {
      const alert = await getDoc(id)
      if (!alert || alert.tenantId !== body.tenantId) return json(res, 404, { error: 'Alert not found' })
      await updateDoc(id, { read: 'true', readAt: new Date().toISOString(), readBy: auth.identity.uid })
      invalidateAdminReadCache(body.tenantId)
      return json(res, 200, { ok: true, data: { read: true } })
    } catch { return json(res, 503, { error: 'No fue posible actualizar la alerta.' }) }
  }
  if (body.operation === 'dashboard') {
    if (process.env.FIRESTORE_QUOTA_SAFE_MODE === 'true') return json(res, 503, { ok: false, errorCode: 'FIRESTORE_QUOTA_SAFE_MODE', error: 'El dashboard está pausado mientras Firestore está en modo de cuota segura.' })
    const selected = typeof body.tenantId === 'string' && body.tenantId !== 'all' ? [body.tenantId] : tenantIds
    if (selected.some(id => !(id in tenantDefinitions))) return json(res, 403, { error: 'Tenant not allowed' })
    try { return json(res, 200, { ok: true, data: await Promise.all(selected.map(tenantId => cachedAdminRead(`dashboard:${tenantId}`, () => dashboard(tenantId), { ttlMs: 10_000, failureTtlMs: 15_000 }))) }) }
    catch (error) { return readFailure(res, 'dashboard_failed', typeof body.tenantId === 'string' ? body.tenantId : undefined, error) }
  }

  if (!body.operation || !allowed.has(body.operation as CommerceGatewayOperation)) return json(res, 400, { error: 'Unknown admin operation' })
  if (typeof body.tenantId !== 'string' || !(body.tenantId in tenantDefinitions)) return json(res, 403, { error: 'Tenant not allowed' })
  const input = body.input && typeof body.input === 'object' ? body.input as Record<string, unknown> : {}
  try {
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : mutations.has(body.operation) ? crypto.randomUUID() : undefined
    let data = await runtime.execute({
      operation: body.operation as CommerceGatewayOperation,
      tenantId: body.tenantId,
      input,
      idempotencyKey,
      correlationId: Array.isArray(req.headers['x-vercel-id']) ? req.headers['x-vercel-id'][0] : req.headers['x-vercel-id'],
      actor: {
        actorId: auth.identity.uid,
        role: 'PLATFORM_OWNER',
      },
    })
    if (body.operation === 'listPaymentReviews' && Array.isArray(data)) {
      const customers = await runtime.execute({ operation: 'listCustomers', tenantId: body.tenantId, input: {} }) as Array<{ id?: string; name?: string; phone?: string }>
      const byId = new Map(customers.map(customer => [customer.id, customer]))
      data = (data as PaymentReview[]).map(review => {
        const customer = byId.get(review.order.customerId)
        return { ...review, ...(customer ? { customer: { name: customer.name || '', phone: customer.phone || '' } } : {}) }
      })
    }
    const resultOrderId = (data && typeof data === 'object' ? (data as { orderId?: unknown }).orderId : undefined)
    const orderId = typeof input.orderId === 'string' ? input.orderId : typeof resultOrderId === 'string' ? resultOrderId : ''
    if (body.operation === 'approvePayment' && orderId) {
      const detail = await runtime.execute({ operation: 'getOrderDetail', tenantId: body.tenantId, input: { orderId } }) as { order?: { fulfillmentStatus?: string } } | undefined
      if (detail?.order?.fulfillmentStatus === 'UNFULFILLED') {
        await runtime.execute({ operation: 'startPreparation', tenantId: body.tenantId, input: { orderId }, idempotencyKey: `${idempotencyKey}:auto-start-preparation`, actor: { actorId: auth.identity.uid, role: 'PLATFORM_OWNER' } })
      }
    }
    if (mutations.has(body.operation as string)) invalidateAdminReadCache(body.tenantId)
    const notificationStatus: Record<string, string> = { approvePayment: 'PAYMENT_APPROVED', rejectPaymentProof: 'PAYMENT_REJECTED', startPreparation: 'PREPARING', markReady: 'READY', dispatchOrder: 'DISPATCHED', markDelivered: 'DELIVERED' }
    let notification: unknown
    if (body.tenantId === 'tenant-floes' && orderId && notificationStatus[body.operation]) {
      try { notification = await notifyOrderStatus(body.tenantId, orderId, notificationStatus[body.operation]) }
      catch (error) {
        notification = { status: 'ERROR' }
        console.error(JSON.stringify({ service: 'admin', stage: 'order_notification_failed', tenantId: body.tenantId, operation: body.operation, orderId, message: error instanceof Error ? error.message : 'unknown' }))
      }
    }
    console.info(JSON.stringify({ service: 'admin', stage: mutations.has(body.operation) ? 'mutation_completed' : 'read_completed', actorRole: 'PLATFORM_OWNER', tenantId: body.tenantId, operation: body.operation }))
    return json(res, 200, { ok: true, data, ...(notification ? { notification } : {}) })
  } catch (error) {
    console.error(JSON.stringify({ service: 'admin', stage: 'operation_failed', actorRole: 'PLATFORM_OWNER', tenantId: body.tenantId, operation: body.operation, message: error instanceof Error ? error.message : 'unknown' }))
    return json(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Administrative operation failed' })
  }
}
