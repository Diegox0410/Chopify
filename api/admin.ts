import type { CommerceGatewayOperation } from '../src/application/commerceGateway.js'
import { PersistentCommerceRuntime, tenantDefinitions } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
import { authorizePlatformOwner } from './_lib/firebaseAuth.js'

interface Request { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface Response { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }
interface Body { operation?: string; tenantId?: unknown; input?: unknown; idempotencyKey?: unknown }

const runtime = new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
const tenantIds = Object.keys(tenantDefinitions) as Array<keyof typeof tenantDefinitions>
const allowed = new Set<CommerceGatewayOperation>([
  'listProducts', 'syncFloesCatalog', 'updateProduct', 'ownerDashboard', 'listOrders',
  'getOrderDetail', 'listPaymentReviews', 'approvePayment', 'rejectPaymentProof',
  'startPreparation', 'markReady', 'dispatchOrder', 'markDelivered',
])
const mutations = new Set(['syncFloesCatalog', 'updateProduct', 'approvePayment', 'rejectPaymentProof', 'startPreparation', 'markReady', 'dispatchOrder', 'markDelivered'])
const json = (res: Response, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')
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

async function dashboard(tenantId: string) {
  const [summary, orders] = await Promise.all([
    runtime.execute({ operation: 'ownerDashboard', tenantId, input: {} }),
    runtime.execute({ operation: 'listOrders', tenantId, input: {} }),
  ])
  const rows = orders as Array<{
    paymentStatus: string
    fulfillmentStatus: string
    grandTotalCents: number
    currency?: string
    managedSnapshot?: { managed: boolean }
  }>
  const totals = summary as { managedRevenueBaseCents?: number }

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
        .reduce((total, row) => total + row.grandTotalCents, 0),
    ])
  )

  const managedRevenue =
    currencies.length === 1
      ? {
          cents: revenueByCurrency[currencies[0]],
          currency: currencies[0],
        }
      : null
  return {
    tenantId,
    summary,
    paymentApproved: rows.filter(row => row.paymentStatus === 'PAID').length,
    paymentRejected: rows.filter(row => row.paymentStatus === 'REJECTED').length,
    preparing: rows.filter(row => row.fulfillmentStatus === 'PREPARING').length,
    ready: rows.filter(row => row.fulfillmentStatus === 'READY').length,
    dispatched: rows.filter(row => row.fulfillmentStatus === 'DISPATCHED').length,
    delivered: rows.filter(row => row.fulfillmentStatus === 'DELIVERED').length,
    managedRevenueCents: managedRevenue?.cents ?? (
      rows.length === 0 && totals.managedRevenueBaseCents === 0
        ? 0
        : null
    ),
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
  }
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
    whatsapp: configured(['META_WHATSAPP_ACCESS_TOKEN', 'FLOES_WHATSAPP_PHONE_NUMBER_ID']),
    ganobot: configured(['GANOBOT_LIVE_URL', 'GANOBOT_LIVE_BEARER_TOKEN']),
    storefront: 'UNKNOWN',
  } })
  if (body.operation === 'dashboard') {
    const selected = typeof body.tenantId === 'string' && body.tenantId !== 'all' ? [body.tenantId] : tenantIds
    if (selected.some(id => !(id in tenantDefinitions))) return json(res, 403, { error: 'Tenant not allowed' })
    try { return json(res, 200, { ok: true, data: await Promise.all(selected.map(dashboard)) }) }
    catch (error) { console.error(JSON.stringify({ service: 'admin', stage: 'dashboard_failed', message: error instanceof Error ? error.message : 'unknown' })); return json(res, 503, { error: 'Administrative data unavailable' }) }
  }

  if (!body.operation || !allowed.has(body.operation as CommerceGatewayOperation)) return json(res, 400, { error: 'Unknown admin operation' })
  if (typeof body.tenantId !== 'string' || !(body.tenantId in tenantDefinitions)) return json(res, 403, { error: 'Tenant not allowed' })
  const input = body.input && typeof body.input === 'object' ? body.input as Record<string, unknown> : {}
  try {
    const data = await runtime.execute({
      operation: body.operation as CommerceGatewayOperation,
      tenantId: body.tenantId,
      input,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : mutations.has(body.operation) ? crypto.randomUUID() : undefined,
      correlationId: Array.isArray(req.headers['x-vercel-id']) ? req.headers['x-vercel-id'][0] : req.headers['x-vercel-id'],
      actor: {
        actorId: auth.identity.uid,
        role: 'PLATFORM_OWNER',
      },
    })
    console.info(JSON.stringify({ service: 'admin', stage: mutations.has(body.operation) ? 'mutation_completed' : 'read_completed', actorUid: auth.identity.uid, tenantId: body.tenantId, operation: body.operation }))
    return json(res, 200, { ok: true, data })
  } catch (error) {
    console.error(JSON.stringify({ service: 'admin', stage: 'operation_failed', actorUid: auth.identity.uid, tenantId: body.tenantId, operation: body.operation, message: error instanceof Error ? error.message : 'unknown' }))
    return json(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Administrative operation failed' })
  }
}
