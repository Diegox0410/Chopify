import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { normalizeCatalogKey, previewCatalogImport } from '../src/application/catalogImport.js'
import { readCatalogFile } from '../src/application/catalogFiles.js'
import { PublicCatalogStorage } from '../src/infrastructure/publicCatalogStorage.js'

const workbookPath = resolve(process.cwd(), 'Plantilla_Maestra_FLOES_Productos 1700.xlsx')
const publicDirectory = process.env.FLOES_PUBLIC_CATALOG_DIRECTORY?.trim()
if (!publicDirectory) throw new Error('FLOES_PUBLIC_CATALOG_DIRECTORY must point to floes-commerce/public/catalogo/floes')
const env = { ...process.env, FLOES_PUBLIC_BASE_URL: process.env.FLOES_PUBLIC_BASE_URL?.trim() || 'https://preview-not-deployed.invalid' }
const bytes = await readFile(workbookPath)
const workbookBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const allRows = await readCatalogFile(basename(workbookPath), workbookBuffer)
const pilotModels = new Set(['maria-jose', 'daniela', 'elite'])
const modelForRow = (row: Record<string, unknown>) => normalizeCatalogKey(String(row.nombre_producto ?? '').replace(/^modelo\s+/i, ''))
const rows = allRows.filter(row => pilotModels.has(modelForRow(row)))
const excludedModels = [...new Set(allRows.map(modelForRow).filter(model => model && !pilotModels.has(model)))].sort()
const storage = new PublicCatalogStorage({ env, publicDirectory })
const imageUrls: Record<string, string> = {}

for (const row of rows) {
  const reference = String(row.imagen_1 ?? '').trim()
  const model = String(row.nombre_producto ?? '').replace(/^modelo\s+/i, '').trim()
  const color = String(row.color ?? '').trim()
  if (!reference || !model || !color) continue
  const url = await storage.getPublicUrl({ tenantId: 'tenant-floes', model, color })
  if (!await storage.exists({ tenantId: 'tenant-floes', model, color })) throw new Error(`Missing synchronized image: ${model} / ${color}`)
  imageUrls[reference] = url
}

const preview = previewCatalogImport('tenant-floes', rows, [], imageUrls)
const products = preview.products
const variants = products.flatMap(product => product.variants)
const skus = variants.map(variant => variant.sku.trim().toUpperCase())
const inventoryPositions = variants.flatMap(variant => Object.entries(variant.initialStockBySize ?? {}))
const inventoryUnits = inventoryPositions.reduce((total, [, stock]) => total + (stock ?? 0), 0)
const modelCounts = products.map(product => ({ model: product.name, variants: product.variants.length, colors: product.variants.map(variant => variant.color) }))
const missingOrUnsafeImages = variants.flatMap(variant => variant.images).filter(image => !/^https:\/\//i.test(image.url))
const cafes = variants.filter(variant => variant.color?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'cafe')

const report = {
  workbook: workbookPath,
  workbookRows: allRows.length,
  pilotRows: rows.length,
  excludedModels,
  sourceRows: rows.length,
  products: products.length,
  variants: variants.length,
  modelCounts,
  duplicateSkus: skus.length - new Set(skus).size,
  imageUrls: preview.summary.imagesFound,
  missingImages: preview.summary.imagesMissing,
  missingLocalImages: 39 - Object.keys(imageUrls).length,
  unsafeImageUrls: missingOrUnsafeImages.length,
  cafeVariants: cafes.length,
  inventoryPositions: inventoryPositions.length,
  initialUnits: inventoryUnits,
  errors: preview.issues.filter(issue => issue.severity === 'ERROR').length,
  warnings: preview.issues.filter(issue => issue.severity === 'WARNING').length,
}
console.info(JSON.stringify(report, null, 2))
if (rows.length !== 39 || products.length !== 3 || variants.length !== 39 || products.some(product => product.variants.length !== 13) ||
    preview.summary.imagesFound !== 39 || preview.summary.imagesMissing !== 0 || Object.keys(imageUrls).length !== 39 ||
    skus.length !== new Set(skus).size || cafes.length !== 0 || missingOrUnsafeImages.length !== 0 ||
    inventoryPositions.length !== 195 || inventoryUnits !== 1950 || report.errors !== 0) {
  throw new Error('FLOES pilot dry run did not match the expected 3/39/195/1,950 result')
}
