import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { previewCatalogImport, normalizeCatalogKey } from '../src/application/catalogImport.js'
import { readCatalogFile } from '../src/application/catalogFiles.js'
import { PersistentCommerceRuntime } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
import { PublicCatalogStorage } from '../src/infrastructure/publicCatalogStorage.js'

const tenantId = 'tenant-floes'
const expectedProject = 'chopify-f9b1c'
const expectedCollection = 'chopifyCommerceRuntimePreview'
const expectedBaseUrl = 'https://floes-commerce.vercel.app'
const pilotModels = new Set(['maria-jose', 'daniela', 'elite'])
const required = (value: string | undefined, key: string) => {
  if (!value?.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

const serviceAccount = JSON.parse(required(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'FIREBASE_SERVICE_ACCOUNT_JSON')) as { project_id?: string }
if (serviceAccount.project_id !== expectedProject || process.env.CHOPIFY_FIREBASE_PROJECT_ID !== expectedProject) throw new Error('Firestore project must be chopify-f9b1c')
if (process.env.CHOPIFY_COMMERCE_STATE_COLLECTION !== expectedCollection) throw new Error(`Refusing to write outside ${expectedCollection}`)
if (process.env.CATALOG_IMAGE_STORAGE_PROVIDER !== 'public') throw new Error('CATALOG_IMAGE_STORAGE_PROVIDER must be public')
if (required(process.env.FLOES_PUBLIC_BASE_URL, 'FLOES_PUBLIC_BASE_URL').replace(/\/$/, '') !== expectedBaseUrl) throw new Error('FLOES_PUBLIC_BASE_URL must be https://floes-commerce.vercel.app')

const workbookPath = resolve(process.cwd(), 'Plantilla_Maestra_FLOES_Productos 1700.xlsx')
const imageDirectory = required(process.env.FLOES_PUBLIC_CATALOG_DIRECTORY, 'FLOES_PUBLIC_CATALOG_DIRECTORY')
const bytes = await readFile(workbookPath)
const workbook = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const allRows = await readCatalogFile(basename(workbookPath), workbook)
const modelForRow = (row: Record<string, unknown>) => normalizeCatalogKey(String(row.nombre_producto ?? '').replace(/^modelo\s+/i, ''))
const rows = allRows.filter(row => pilotModels.has(modelForRow(row)))
const storage = new PublicCatalogStorage({ env: process.env, publicDirectory: imageDirectory })
const imageUrls: Record<string, string> = {}

for (const row of rows) {
  const reference = String(row.imagen_1 ?? '').trim()
  const model = String(row.nombre_producto ?? '').replace(/^modelo\s+/i, '').trim()
  const color = String(row.color ?? '').trim()
  if (!reference || !model || !color) throw new Error(`Missing image reference in workbook row ${String(row.__row ?? '')}`)
  const input = { tenantId, model, color }
  if (!await storage.exists(input)) throw new Error(`Local image missing for ${model}/${color}`)
  imageUrls[reference] = await storage.getPublicUrl(input)
}

const stateStore = new FirestoreCommerceStateStore(process.env)
const current = await stateStore.load(tenantId)
const currentModels = current?.state.orders.products.map(product => normalizeCatalogKey(product.name.replace(/^modelo\s+/i, ''))) ?? []
if (currentModels.some(model => !pilotModels.has(model))) throw new Error('Preview state contains non-pilot products; refusing to add to it')

const preview = previewCatalogImport(tenantId, rows, current?.state.orders.products ?? [], imageUrls)
const variants = preview.products.flatMap(product => product.variants)
const skus = variants.map(variant => variant.sku.trim().toUpperCase())
const positions = variants.flatMap(variant => Object.entries(variant.initialStockBySize ?? {}))
const errors = preview.issues.filter(issue => issue.severity === 'ERROR').length
const cafes = variants.filter(variant => normalizeCatalogKey(variant.color ?? '') === 'cafe').length
if (rows.length !== 39 || preview.products.length !== 3 || variants.length !== 39 || preview.products.some(product => product.variants.length !== 13) ||
    positions.length !== 195 || positions.reduce((total, [, stock]) => total + (stock ?? 0), 0) !== 1950 ||
    preview.summary.imagesFound !== 39 || preview.summary.imagesMissing !== 0 || Object.keys(imageUrls).length !== 39 ||
    new Set(skus).size !== 39 || cafes !== 0 || errors !== 0) {
  throw new Error('Final FLOES Preview import dry-run did not match 3/39/195/1,950')
}

const runtime = new PersistentCommerceRuntime(stateStore)
const result = await runtime.execute({
  operation: 'importCatalog', tenantId, input: { rows, imageUrls }, idempotencyKey: 'floes-pilot-preview-catalog-v1',
}) as { committed?: boolean }
if (result.committed !== true) throw new Error('Catalog import was not committed')

const saved = await stateStore.load(tenantId)
if (!saved) throw new Error('Firestore read-back did not find the pilot document')
const savedProducts = saved.state.orders.products
const savedVariants = savedProducts.flatMap(product => product.variants)
const savedPositions = saved.state.orders.inventory
const savedUnits = savedPositions.reduce((total, position) => total + position.onHand, 0)
if (savedProducts.length !== 3 || savedVariants.length !== 39 || savedPositions.length !== 195 || savedUnits !== 1950 ||
    savedProducts.some(product => !pilotModels.has(normalizeCatalogKey(product.name.replace(/^modelo\s+/i, ''))) || product.variants.length !== 13)) {
  throw new Error('Firestore read-back did not match 3/39/195/1,950')
}

console.info(JSON.stringify({
  workbook: workbookPath,
  firestoreProject: expectedProject,
  firestoreCollection: expectedCollection,
  committed: result.committed,
  products: savedProducts.length,
  variants: savedVariants.length,
  inventoryPositions: savedPositions.length,
  initialUnits: savedUnits,
  images: preview.summary.imagesFound,
  duplicateSkus: skus.length - new Set(skus).size,
  cafes,
}, null, 2))
