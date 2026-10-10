import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { normalizeCatalogKey } from '../src/application/catalogImport.js'
import { readCatalogFile } from '../src/application/catalogFiles.js'
import type { CatalogRow } from '../src/application/catalogImport.js'
import { effectiveSalePrice, type CommerceProduct, type CommerceProductVariant } from '../src/domain/commerce.js'
import { PublicCatalogStorage } from '../src/infrastructure/publicCatalogStorage.js'

// Calls only the immutable Chopify Preview API. A mutation requires an order
// created by the GanoBot conversation and can never create a second order.
const tenantId = 'tenant-floes'
const collection = 'chopifyCommerceRuntimePreview'
const pilotModels = new Set(['maria-jose', 'daniela', 'elite'])
const sizes = ['XS', 'S', 'M', 'L', 'XL'] as const
const runId = `floes-preview-e2e-${randomUUID()}`
const mutationEnabled = process.argv.includes('--mutate')
const existingOrderId = process.argv.find(argument => argument.startsWith('--existing-order='))?.slice('--existing-order='.length)
const checks: Array<{ check: string; result: 'PASS' }> = []
const evidence: Record<string, unknown> = {}
let previewOrigin = ''

type Json = Record<string, unknown>
type ApiScope = 'commerce' | 'owner'
type PreviewVariant = CommerceProductVariant & { images: readonly { url: string }[] }
type PreviewProduct = CommerceProduct & { variants: PreviewVariant[] }
type PreviewOrder = Json & { id: string; tenantId: string; customerId: string; items: Array<Json>; fulfillmentStatus: string; paymentStatus: string }
type ApiResult = { response: Response; payload: Json }

const required = (key: string) => {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing ${key}`)
  return value
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const pass = (check: string) => {
  checks.push({ check, result: 'PASS' })
  console.info(JSON.stringify({ check, result: 'PASS' }))
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const modelKey = (name: string) => normalizeCatalogKey(name.replace(/^modelo\s+/i, ''))
const expectedHeader = (response: Response) => {
  assert(response.headers.get('x-chopify-commerce-collection') === collection, 'Remote endpoint did not corroborate the Preview Firestore collection')
}

async function main() {
  const url = new URL(required('FLOES_E2E_CHOPIFY_PREVIEW_URL'))
  const verifiedHost = required('FLOES_E2E_VERIFIED_PREVIEW_HOST')
  assert(url.protocol === 'https:' && url.hostname === verifiedHost && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password, 'Preview URL must match the independently verified deployment host')
  assert(/^chopify-[a-z0-9]+-[a-z0-9-]+\.vercel\.app$/.test(url.hostname), 'Refusing a Production alias or a non-Chopify Vercel deployment')
  assert(url.hostname !== 'chopify.vercel.app' && url.hostname !== 'floes-commerce.vercel.app', 'Production aliases cannot be tested')
  assert(process.env.VERCEL_ENV === 'preview', 'Local runner must load Preview environment variables')
  previewOrigin = url.origin

  const tokens: Record<ApiScope, string> = {
    commerce: required('CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN'),
    owner: required('CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES'),
  }
  assert(tokens.commerce !== tokens.owner, 'Preview E2E commerce and owner credentials must be distinct')

  const call = async (operation: string, input: Json = {}, scope: ApiScope = 'commerce', extra: { token?: string; tenant?: string; bodyTenant?: string; key?: string; noToken?: boolean } = {}): Promise<ApiResult> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'X-Chopify-Tenant-Id': extra.tenant ?? tenantId,
      'X-Correlation-Id': runId, 'X-Request-Id': `${runId}:${operation}`,
    }
    if (!extra.noToken) headers.Authorization = `Bearer ${extra.token ?? tokens[scope]}`
    if (scope === 'owner') headers['X-Chopify-Access-Scope'] = 'owner'
    const protection = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
    if (protection && protection !== '[SENSITIVE]') headers['x-vercel-protection-bypass'] = protection
    const response = await fetch(`${previewOrigin}/api/commerce`, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ operation, input, idempotencyKey: extra.key ?? `${runId}:${operation}`, ...(extra.bodyTenant ? { tenantId: extra.bodyTenant } : {}) }),
    })
    const contentType = response.headers.get('content-type') ?? ''
    assert(contentType.includes('application/json'), 'Commerce endpoint returned a non-JSON response; deployment protection or routing may be active')
    return { response, payload: await response.json() as Json }
  }
  const success = async (operation: string, input: Json = {}, scope: ApiScope = 'commerce', key?: string) => {
    const { response, payload } = await call(operation, input, scope, { key })
    expectedHeader(response)
    assert(response.status === 200 && payload.ok === true, `Commerce operation failed: ${operation} (HTTP ${response.status})`)
    return payload.data
  }
  const publicHeaders: Record<string, string> = {}
  const protection = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  if (protection && protection !== '[SENSITIVE]') publicHeaders['x-vercel-protection-bypass'] = protection
  const publicCatalog = await fetch(`${previewOrigin}/api/catalog?tenant=${tenantId}`, { headers: publicHeaders, redirect: 'error', signal: AbortSignal.timeout(30000) })
  expectedHeader(publicCatalog)
  assert(publicCatalog.ok, 'Explicit-tenant public catalog is unavailable')
  const publicProducts = await publicCatalog.json() as Json[]
  assert(publicProducts.length === 3 && publicProducts.every(product => !('ganoBotNotes' in product)), 'Public catalog has extra models or internal GanoBot notes')
  const publicDaniela = publicProducts.find(product => modelKey(String(product.name ?? '')) === 'daniela')
  assert(publicDaniela && Array.isArray(publicDaniela.variants) && publicDaniela.variants.length === 13, 'Public Daniela catalog must expose exactly 13 colors')
  assert(publicProducts.every(product => {
    const guide = product.sizeGuide as Json | undefined
    return guide?.measurement === 'FLAT_GARMENT_CM' && Array.isArray(guide.blouse) && guide.blouse.length === 5 && Array.isArray(guide.trousers) && guide.trousers.length === 5
  }), 'Public FLOES products must expose the complete global flat-garment guide')
  const noTenant = await fetch(`${previewOrigin}/api/catalog`, { headers: publicHeaders, redirect: 'error', signal: AbortSignal.timeout(30000) })
  assert(noTenant.status === 400, 'Public catalog must require an explicit tenant')
  pass('public_catalog_tenant_isolation_and_global_size_guide')

  const products = await success('listProducts', {}, 'owner') as PreviewProduct[]
  assert(Array.isArray(products) && products.length === 3 && products.every(product => product.tenantId === tenantId && pilotModels.has(modelKey(product.name))), 'Preview catalog must contain only the three FLOES pilot models')
  const orders = await success('listOrders', {}, 'owner') as PreviewOrder[]
  assert(Array.isArray(orders) && orders.every(order => order.tenantId === tenantId), 'Owner order list contains a foreign tenant')
  pass('preview_catalog_and_order_tenant_scope')

  const baselineProductsHash = hash(products)
  for (const [name, operation, scope, extra, expected] of [
    ['missing_credential', 'searchProducts', 'commerce', { noToken: true }, 401],
    ['invalid_credential', 'searchProducts', 'commerce', { token: 'invalid-preview-e2e-credential' }, 401],
    ['commerce_cannot_approve', 'approvePayment', 'commerce', {}, 401],
    ['commerce_cannot_spoof_owner', 'approvePayment', 'owner', { token: tokens.commerce }, 401],
    ['owner_cannot_access_other_tenant', 'listOrders', 'owner', { tenant: 'tenant-mg' }, 403],
    ['commerce_cannot_access_other_tenant', 'searchProducts', 'commerce', { tenant: 'tenant-mg' }, 403],
    ['body_tenant_rejected', 'searchProducts', 'commerce', { bodyTenant: tenantId }, 400],
  ] as const) {
    const result = await call(operation, {}, scope, extra)
    assert(result.response.status === expected, `Authorization check failed: ${name} (HTTP ${result.response.status})`)
    pass(name)
  }

  const imageUrls = [...new Set(products.flatMap(product => product.variants.flatMap(variant => variant.images.map(image => image.url))))]
  assert(imageUrls.length === 39, 'Pilot must contain 39 distinct real image URLs')
  for (const imageUrl of imageUrls) {
    const image = new URL(imageUrl)
    assert(image.protocol === 'https:' && image.pathname.startsWith('/catalogo/floes/') && !image.hostname.includes('firebasestorage') && !image.hostname.includes('storage.googleapis'), 'Catalog image is outside FLOES PublicCatalogStorage')
    const response = await fetch(imageUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000) })
    assert(response.ok && (response.headers.get('content-type') ?? '').startsWith('image/'), 'Pilot image is not served as a real image')
    assert((await response.arrayBuffer()).byteLength > 0, 'Pilot image is empty')
  }
  pass('all_39_public_catalog_images_http_ok')

  const daniela = products.find(product => modelKey(product.name) === 'daniela')
  const vino = daniela?.variants.find(variant => variant.sku === 'FLOES-DAN-11' && variant.color?.trim().toLocaleLowerCase('es') === 'vino')
  assert(daniela && vino && vino.sizes?.includes('M'), 'Daniela / FLOES-DAN-11 Vino / M is missing from the Preview catalog')
  const salePrice = effectiveSalePrice(daniela as CommerceProduct, vino as CommerceProductVariant)
  assert(salePrice === 3499 && daniela.currency === 'USD', 'Daniela / Vino promotional price must be USD 34.99 with a USD 39.99 regular price')
  const price = vino.salePriceCents ?? daniela.salePriceCents
  assert(price === 3999, 'Daniela / Vino regular price must be USD 39.99')
  const availabilityInput = (size: string, quantity = 1) => ({ productId: daniela.id, variantId: vino.id, size, quantity })
  const readSizeStock = async () => {
    const entries = await Promise.all(sizes.map(async size => {
      const result = await success('checkAvailability', availabilityInput(size)) as Json
      assert(typeof result.availableQuantity === 'number', `Stock is missing for Daniela/Vino/${size}`)
      return [size, result.availableQuantity] as const
    }))
    return Object.fromEntries(entries) as Record<(typeof sizes)[number], number>
  }
  const stockBefore = await readSizeStock()
  const invalidSize = await success('checkAvailability', availabilityInput('UNDOCUMENTED-E2E-SIZE')) as Json
  assert(invalidSize.available === false, 'Undocumented size must never be available')
  const unavailable = await success('checkAvailability', availabilityInput('M', stockBefore.M + 1)) as Json
  assert(unavailable.available === false, 'Excess quantity must be unavailable')
  pass('daniela_vino_m_real_price_and_size_specific_stock')

  const workbookPath = resolve(process.cwd(), 'Plantilla_Maestra_FLOES_Productos 1700.xlsx')
  const bytes = await readFile(workbookPath)
  const workbook = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const workbookRows = await readCatalogFile(basename(workbookPath), workbook)
  const rows = workbookRows.filter(row => pilotModels.has(modelKey(String(row.nombre_producto ?? ''))))
  assert(rows.length === 39, 'Controlled reimport source must contain exactly the 39 pilot rows')
  const sourceColors = new Set(rows.map(row => normalizeCatalogKey(String(row.color ?? ''))))
  assert(sourceColors.size === 13 && !sourceColors.has('cafe') && !sourceColors.has('azul-petroleo'), 'Pilot import must keep 13 approved colors and exclude Café/AZUL_PETROLEO')
  const imageStorage = new PublicCatalogStorage({ env: { FLOES_PUBLIC_BASE_URL: 'https://floes-commerce.vercel.app' } })
  const imageManifest: Record<string, string> = {}
  for (const row of rows) {
    const reference = String(row.imagen_1 ?? '').trim()
    const model = String(row.nombre_producto ?? '').replace(/^modelo\s+/i, '').trim()
    const color = String(row.color ?? '').trim()
    assert(reference && model && color, `Missing reimport image data in source row ${String(row.__row ?? '')}`)
    imageManifest[reference] = await imageStorage.getPublicUrl({ tenantId, model, color })
  }
  assert(Object.keys(imageManifest).length === 39, 'Controlled reimport must map all 39 public images')
  const importInput = { rows: rows as CatalogRow[], imageUrls: imageManifest }
  const importPreview = await success('previewCatalogImport', importInput, 'owner') as Json
  const importIssues = Array.isArray(importPreview.issues) ? importPreview.issues as Json[] : []
  assert(!importIssues.some(issue => issue.severity === 'ERROR'), 'Controlled reimport preview contains catalog errors')
  const importProducts = Array.isArray(importPreview.products) ? importPreview.products as PreviewProduct[] : []
  assert(importProducts.length === 3 && importProducts.flatMap(product => product.variants).length === 39, 'Controlled reimport preview must retain exactly 3 models and 39 variants')
  const importSummary = importPreview.summary as Json | undefined
  assert(importSummary?.imagesFound === 39 && importSummary.imagesMissing === 0, 'Controlled reimport preview must resolve all 39 public images')
  pass('controlled_reimport_preview_has_no_catalog_errors')

  const existingOrder = existingOrderId ? orders.find(order => order.id === existingOrderId) : undefined
  if (mutationEnabled) assert(existingOrderId && existingOrder, 'Mutation requires the one existing GanoBot Preview order; this script will not create a second order')
  if (existingOrderId) {
    const line = existingOrder?.items[0]
    assert(existingOrder && existingOrder.tenantId === tenantId && line?.quantity === 1 && line.productId === daniela.id && line.variantId === vino.id && line.size === 'M', 'Existing Preview order must be one Daniela / Vino / M unit')
    assert(existingOrder.fulfillmentStatus === 'UNFULFILLED' && ['UNPAID', 'PROOF_RECEIVED', 'UNDER_REVIEW'].includes(existingOrder.paymentStatus), 'Existing Preview order must be unfulfilled and awaiting Owner approval')
  }

  if (!mutationEnabled) {
    const after = await readSizeStock()
    assert(hash(after) === hash(stockBefore), 'Read-only E2E changed Preview stock')
    pass('read_only_checks_preserve_preview_stock')
    evidence.catalog = { products: products.length, variants: products.flatMap(product => product.variants).length, images: imageUrls.length, stockDanielaVino: stockBefore }
    return
  }

  assert(existingOrderId && existingOrder, 'Missing GanoBot-created Preview order')
  let detail = await success('getOrderDetail', { orderId: existingOrderId }, 'owner') as Json
  let persistedOrder = detail.order as Json
  const orderLines = persistedOrder.items as Array<Json>
  assert(orderLines[0]?.size === 'M' && orderLines[0]?.variantId === vino.id && orderLines[0]?.imageUrl === vino.images[0]?.url && orderLines[0]?.unitPriceCents === salePrice, 'GanoBot order snapshot lost the real size, color, image, or price')
  assert((detail.reservation as Json)?.status === 'ACTIVE', 'GanoBot order must hold an active M reservation before payment review')
  const orderStatus = await success('getOrderStatus', { orderId: existingOrderId }) as Json
  assert(['unpaid', 'pending_review'].includes(String(orderStatus.paymentStatus)) && orderStatus.fulfillmentStatus === 'unfulfilled', 'GanoBot order must await Owner approval and remain unfulfilled')
  pass('one_ganobot_order_snapshot_and_active_m_reservation')

  const customerId = existingOrder.customerId
  if (!(persistedOrder.fulfillmentDetails as Json | undefined)?.deliveryMode) await success('updateOrderDelivery', { orderId: existingOrderId, customerId, deliveryMode: 'PICKUP' })
  const premature = await call('startPreparation', { orderId: existingOrderId }, 'owner')
  assert(premature.response.status === 400, 'An unpaid order must not enter preparation')
  pass('unpaid_fulfillment_guard')

  const reimportResult = await success('importCatalog', importInput, 'owner', `${runId}:controlled-reimport`) as Json
  assert(reimportResult.committed === true, 'Preview reimport was not committed')
  const afterImportProducts = await success('listProducts', {}, 'owner') as PreviewProduct[]
  assert(afterImportProducts.length === 3 && afterImportProducts.flatMap(product => product.variants).length === 39, 'Reimport added or removed a pilot product or variant')
  const stockAfterImport = await readSizeStock()
  assert(hash(stockAfterImport) === hash(stockBefore), 'Reimport changed Daniela/Vino stock or restored the reserved M unit')
  const afterImportHash = hash(afterImportProducts)
  assert(afterImportHash === baselineProductsHash, 'Reimport changed the authoritative pilot product set')
  detail = await success('getOrderDetail', { orderId: existingOrderId }, 'owner') as Json
  assert((detail.reservation as Json)?.status === 'ACTIVE', 'Reimport must preserve the active reservation')
  pass('reimport_preserves_reservation_and_operational_size_stock')

  const beforeProofs = Array.isArray(detail.proofs) ? detail.proofs as Json[] : []
  let proof = beforeProofs.find(item => item.orderId === existingOrderId && ['PENDING', 'RECEIVED', 'UNDER_REVIEW'].includes(String(item.status)))
  if (!proof) {
    proof = await success('attachPaymentProof', { orderId: existingOrderId, externalReference: `PREVIEW-TEST-NO-REAL-PAYMENT:${runId}` }) as Json
  }
  assert(proof && typeof proof.id === 'string' && typeof proof.paymentId === 'string' && ['PENDING', 'RECEIVED', 'UNDER_REVIEW'].includes(String(proof.status)), 'PaymentProof must remain pending human review')
  detail = await success('getOrderDetail', { orderId: existingOrderId }, 'owner') as Json
  const pendingProof = (detail.proofs as Json[]).find(item => item.id === proof?.id)
  assert(pendingProof && ['PENDING', 'RECEIVED', 'UNDER_REVIEW'].includes(String(pendingProof.status)) && !(pendingProof.reviewedBy || pendingProof.reviewedAt), 'PaymentProof must have no reviewer before Owner approval')
  const pendingStatus = await success('getOrderStatus', { orderId: existingOrderId }) as Json
  assert(pendingStatus.paymentStatus === 'pending_review' && pendingStatus.fulfillmentStatus === 'unfulfilled', 'Proof must never approve payment automatically')
  pass('payment_proof_pending_until_human_review')

  const approved = await success('approvePayment', { paymentId: proof.paymentId, proofId: proof.id }, 'owner') as Json
  assert(approved.status === 'approved', 'Owner approval did not approve the payment')
  await success('approvePayment', { paymentId: proof.paymentId, proofId: proof.id }, 'owner')
  detail = await success('getOrderDetail', { orderId: existingOrderId }, 'owner') as Json
  assert((detail.reservation as Json).status === 'COMMITTED', 'Approved payment must commit its inventory reservation')
  const approvedProof = (detail.proofs as Json[]).find(item => item.id === proof?.id)
  assert(approvedProof?.status === 'APPROVED' && typeof approvedProof.reviewedBy === 'string' && approvedProof.reviewedBy !== 'ganobot-commerce', 'Payment approval requires an authenticated human reviewer')
  const audit = detail.audit as Json[]
  assert(audit.some(item => item.type === 'PAYMENT_APPROVED' && item.actorId === approvedProof.reviewedBy && item.actorType !== 'AUTOMATION' && (item.metadata as Json)?.correlationId === runId), 'Owner payment approval audit or correlation trace is missing')
  evidence.ownerApproval = { actorId: approvedProof.reviewedBy, credentialRole: 'TENANT_OWNER', reviewWasTestControlled: true, actualFundsVerified: false }
  pass('owner_approval_audit_and_inventory_commit')

  for (const [operation, status] of [['startPreparation', 'preparing'], ['markReady', 'ready-for-dispatch'], ['dispatchOrder', 'dispatched'], ['markDelivered', 'delivered']] as const) {
    const result = await success(operation, { orderId: existingOrderId, ...(operation === 'dispatchOrder' ? { courier: 'PREVIEW-E2E', trackingCode: runId } : {}) }, 'owner') as Json
    assert(result.fulfillmentStatus === status && result.paymentStatus === 'approved', `Fulfillment transition failed: ${operation}`)
    const tracked = await success('getOrderStatus', { orderId: existingOrderId }) as Json
    assert(tracked.fulfillmentStatus === status, `Customer tracking disagrees after ${operation}`)
    pass(`owner_${operation}_and_customer_tracking`)
  }
  await success('recordOrderFollowUp', { orderId: existingOrderId, customerId, outcome: 'SATISFIED', note: 'Prueba Preview; sin entrega física ni pago real.' })
  detail = await success('getOrderDetail', { orderId: existingOrderId }, 'owner') as Json
  persistedOrder = detail.order as Json
  assert(persistedOrder.orderStatus === 'COMPLETED' && (persistedOrder.followUp as Json)?.outcome === 'SATISFIED', 'Post-delivery follow-up must be durable')
  const finalStock = await readSizeStock()
  assert(hash(finalStock) === hash(stockBefore), 'Fulfillment changed stock beyond the one reserved Daniela/Vino/M unit')
  const finalProducts = await success('listProducts', {}, 'owner') as PreviewProduct[]
  assert(finalProducts.length === 3 && hash(finalProducts) === baselineProductsHash, 'Final read-back found a tenant or catalog change')
  evidence.order = { orderId: existingOrderId, paymentId: proof.paymentId, proofId: proof.id, finalStatus: 'COMPLETED', followUp: 'SATISFIED', stockBeforeLifecycle: stockBefore, stockAfterReimportAndFulfillment: finalStock, realPaymentOrPhysicalDelivery: false }
  pass('durable_delivery_follow_up_and_preview_read_back')
}

let failed: string | undefined
try { await main() }
catch (error) {
  failed = error instanceof Error ? error.message : 'Unknown Preview E2E failure'
  for (const [key, value] of Object.entries(process.env)) {
    if (value && /TOKEN|SECRET|PRIVATE|SERVICE_ACCOUNT|PASSWORD/i.test(key)) failed = failed.split(value).join('[REDACTED]')
  }
  process.exitCode = 1
}
const report = { runId, previewOrigin, firestoreCollection: collection, mode: mutationEnabled ? 'PREVIEW_LIFECYCLE_MUTATION' : 'READ_ONLY', result: failed ? 'FAIL' : 'PASS', checks, evidence, ...(failed ? { failed } : {}), realWhatsAppVerified: false, realPaymentOrPhysicalDeliveryVerified: false }
const reportDirectory = resolve(process.cwd(), '.vercel', 'e2e-reports')
await mkdir(reportDirectory, { recursive: true })
const reportPath = resolve(reportDirectory, `${runId}.json`)
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.info(JSON.stringify({ result: report.result, checks: checks.length, reportPath, ...(failed ? { failed } : {}) }, null, 2))
