import type { CommerceProduct, CommerceProductVariant } from '../domain/commerce.js'
import { normalizeCatalogKey } from './catalogImport.js'

export const FLOES_OFFICIAL_MODELS = [
  { id: 'tenant-floes:model:daniela', slug: 'daniela', name: 'Daniela', parentSku: 'MODEL-DANIELA' },
  { id: 'tenant-floes:model:maria-jose', slug: 'maria-jose', name: 'María José', parentSku: 'MODEL-MARIA-JOSE' },
  { id: 'tenant-floes:model:elite', slug: 'elite', name: 'Élite', parentSku: 'MODEL-ELITE' },
  { id: 'tenant-floes:model:maemi', slug: 'maemi', name: 'Maemi', parentSku: 'MODEL-MAEMI' },
  { id: 'tenant-floes:model:esperanza', slug: 'esperanza', name: 'Esperanza', parentSku: 'MODEL-ESPERANZA' },
  { id: 'tenant-floes:model:klit', slug: 'klit', name: 'Klit', parentSku: 'MODEL-KLIT' },
  { id: 'tenant-floes:model:florma', slug: 'florma', name: 'Florma', parentSku: 'MODEL-FLORMA' },
  { id: 'tenant-floes:model:girasol', slug: 'girasol', name: 'Girasol', parentSku: 'MODEL-GIRASOL' },
  { id: 'tenant-floes:model:bruni', slug: 'bruni', name: 'Bruni', parentSku: 'MODEL-BRUNI' },
  { id: 'tenant-floes:model:laly', slug: 'laly', name: 'Laly', parentSku: 'MODEL-LALY' },
  { id: 'tenant-floes:model:esencial', slug: 'esencial', name: 'Esencial', parentSku: 'MODEL-ESENCIAL' },
  { id: 'tenant-floes:model:mabe', slug: 'mabe', name: 'Mabe', parentSku: 'MODEL-MABE' },
] as const

type Row = Record<string, unknown>
export interface FloesCatalogSyncDiff {
  products: CommerceProduct[]
  summary: {
    officialProducts: number
    inputRows: number
    variantsBefore: number
    variantsAfter: number
    preservedExistingVariants: number
    newVariants: number
    changedExistingVariants: number
    newSizeInventoryPositions: number
    promotionChanges: number
    variantImageAssignments: number
    archivedOfficialProducts: number
    archivedHistoricalProductsPreserved: number
    duplicateSkus: number
    productPriceUpdates: number
  }
  diff: Array<{
    productId: string
    model: string
    parentSku: string
    newSku: string
    color: string
    regularPriceCents: number
    sizes: string[]
    stock: null
    promotionalPriceCents: null
    images: 0
  }>
  modelSummary: Array<{
    productId: string
    model: string
    parentSku: string
    variantsBefore: number
    variantsAfter: number
    newVariants: number
    parentPriceBeforeCents: number | null
    parentPriceAfterCents: number | null
    productGalleryImagesPreserved: number
  }>
}

const text = (value: unknown) => value == null ? '' : String(value).trim()
const key = (value: unknown) => text(value).toUpperCase()
const normalizedFields = (row: Row) => Object.fromEntries(
  Object.entries(row).map(([name, value]) => [normalizeCatalogKey(name).replace(/-/g, '_'), value]),
)
const modelName = (value: string) => value.replace(/^modelo\s+/i, '').trim()
const modelKey = (value: string) => normalizeCatalogKey(modelName(value))

function amount(value: unknown, label: string): number {
  let raw = text(value).replace(/[$€\s]/g, '')
  if (typeof value === 'number') raw = String(value)
  if (raw.includes(',') && raw.includes('.')) {
    raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')
  } else raw = raw.replace(',', '.')
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive regular price`)
  return Math.round(parsed * 100)
}

function sizeList(value: unknown): string[] {
  const sizes = [...new Set(text(value).split(/[,;|/\s-]+/).map(item => item.trim().toUpperCase()).filter(Boolean))]
  if (!sizes.length) throw new Error('Every color SKU must have documented sizes')
  return sizes
}

function isArchived(product: CommerceProduct) { return product.status === 'ARCHIVED' || product.visibility === 'HIDDEN' }

/**
 * Produces a deterministic FLOES-only catalog update. Existing variants and product galleries
 * are copied without mutation; new color SKUs are visible but never purchasable until size stock
 * is confirmed. Workbook promotions, stock, and variant images are deliberately ignored.
 */
export function prepareFloesCatalogSync(source: readonly Row[], existing: readonly CommerceProduct[]): FloesCatalogSyncDiff {
  if (existing.some(product => product.tenantId !== 'tenant-floes')) throw new Error('Cross-tenant catalog rejected')
  const rowsByModel = new Map<string, Array<{ row: Row; sku: string; color: string; priceCents: number; sizes: string[] }>>()
  const seenInputSkus = new Set<string>()
  for (const [index, raw] of source.entries()) {
    const row = normalizedFields(raw)
    const name = text(row.nombre_producto)
    const model = modelKey(name)
    if (!FLOES_OFFICIAL_MODELS.some(item => item.slug === model)) throw new Error(`Unexpected official model on source row ${index + 2}`)
    const sku = text(row.sku)
    const color = text(row.color)
    if (!sku || !color) throw new Error(`Source row ${index + 2} requires a color SKU and color`)
    const skuId = key(sku)
    if (seenInputSkus.has(skuId)) throw new Error(`Duplicate source SKU: ${sku}`)
    seenInputSkus.add(skuId)
    if (text(row.moneda).toUpperCase() !== 'USD') throw new Error(`SKU ${sku} must explicitly use USD`)
    const entry = { row, sku, color, priceCents: amount(row.precio_venta, `SKU ${sku}`), sizes: sizeList(row.talla) }
    const list = rowsByModel.get(model) ?? []
    list.push(entry)
    rowsByModel.set(model, list)
  }
  if (source.length !== 156 || seenInputSkus.size !== 156 || rowsByModel.size !== 12) {
    throw new Error('FLOES master must contain exactly 156 unique color SKUs across 12 official models')
  }
  if ([...rowsByModel.values()].some(items => items.length !== 13)) throw new Error('Each official FLOES model must have exactly 13 color SKUs')

  const productsById = new Map(existing.map(product => [product.id, product]))
  const officialProducts = FLOES_OFFICIAL_MODELS.map(model => {
    const found = productsById.get(model.id)
    if (!found) throw new Error(`Official product id is missing: ${model.id}`)
    if (key(found.sku) !== key(model.parentSku)) throw new Error(`Official parent SKU mismatch for ${model.name}`)
    if (found.status === 'ARCHIVED') throw new Error(`Official product is archived and requires Owner review: ${model.name}`)
    return { model, product: found }
  })

  const allSkuOwners = new Map<string, string>()
  for (const product of existing) {
    for (const sku of [product.sku, ...product.variants.map(variant => variant.sku)]) {
      const normalized = key(sku)
      const prior = allSkuOwners.get(normalized)
      if (prior) throw new Error(`Existing SKU collision requires Owner review: ${sku}`)
      allSkuOwners.set(normalized, product.id)
    }
  }

  const officialIds = new Set(officialProducts.map(({ product }) => product.id))
  const outputProducts: CommerceProduct[] = []
  const diff: FloesCatalogSyncDiff['diff'] = []
  const modelSummary: FloesCatalogSyncDiff['modelSummary'] = []
  let variantsBefore = 0
  let variantsAfter = 0
  let preservedExistingVariants = 0
  let newVariants = 0
  let productPriceUpdates = 0

  for (const { model, product } of officialProducts) {
    if (product.promotionalPriceCents != null) throw new Error(`Product promotion requires approval review: ${model.name}`)
    const modelRows = rowsByModel.get(model.slug)!
    const beforeVariants = product.variants
    variantsBefore += beforeVariants.length
    const variantBySku = new Map(beforeVariants.map(variant => [key(variant.sku), variant]))
    const sourceSkus = new Set(modelRows.map(row => key(row.sku)))
    if (beforeVariants.some(variant => !sourceSkus.has(key(variant.sku)))) {
      throw new Error(`Unreconciled official variant exists for ${model.name}`)
    }

    let addedForModel = 0
    const additions: CommerceProductVariant[] = []
    for (const item of modelRows) {
      const existingVariant = variantBySku.get(key(item.sku))
      if (existingVariant) {
        if (normalizeCatalogKey(text(existingVariant.color)) !== normalizeCatalogKey(item.color)) {
          throw new Error(`Color mismatch for existing SKU ${item.sku}`)
        }
        const existingPrice = existingVariant.salePriceCents === undefined ? product.salePriceCents : existingVariant.salePriceCents
        if (existingPrice !== item.priceCents) throw new Error(`Regular price mismatch for existing SKU ${item.sku}`)
        if (existingVariant.promotionalPriceCents != null) throw new Error(`Existing promotion requires approval review: ${item.sku}`)
        preservedExistingVariants += 1
        continue
      }
      const collisionOwner = allSkuOwners.get(key(item.sku))
      if (collisionOwner) throw new Error(`SKU ${item.sku} already belongs to another product`)
      const variant: CommerceProductVariant = {
        id: `tenant-floes:sku:${encodeURIComponent(key(item.sku))}`,
        sku: item.sku,
        color: item.color,
        status: product.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
        visibility: product.status === 'ACTIVE' && product.visibility === 'VISIBLE' ? 'VISIBLE' : 'HIDDEN',
        images: [],
        stock: null,
        importedStock: null,
        salePriceCents: item.priceCents,
        promotionalPriceCents: null,
        available: false,
        sizes: item.sizes,
        fulfillmentMode: product.fulfillmentMode,
      }
      additions.push(variant)
      diff.push({
        productId: product.id,
        model: model.name,
        parentSku: product.sku,
        newSku: variant.sku,
        color: item.color,
        regularPriceCents: item.priceCents,
        sizes: [...item.sizes],
        stock: null,
        promotionalPriceCents: null,
        images: 0,
      })
      allSkuOwners.set(key(item.sku), product.id)
      addedForModel += 1
      newVariants += 1
    }

    let nextProduct: CommerceProduct = product
    if (additions.length) {
      const existingPrices = beforeVariants.map(variant => variant.salePriceCents ?? product.salePriceCents).filter((value): value is number => value != null)
      const newPrices = additions.map(variant => variant.salePriceCents!).filter(value => value != null)
      const parentPrice = product.salePriceCents ?? Math.min(...existingPrices, ...newPrices)
      const nextCurrency = product.currency ?? 'USD'
      if (nextCurrency !== 'USD') throw new Error(`Official product ${model.name} has non-USD currency`)
      const nextPricingStatus = parentPrice === null ? 'PENDING' : 'READY'
      if (product.salePriceCents !== parentPrice || product.currency !== nextCurrency || product.pricingStatus !== nextPricingStatus) productPriceUpdates += 1
      nextProduct = {
        ...product,
        currency: nextCurrency,
        salePriceCents: parentPrice,
        pricingStatus: nextPricingStatus,
        variants: [...beforeVariants, ...additions],
      }
    }
    outputProducts.push(nextProduct)
    variantsAfter += nextProduct.variants.length
    modelSummary.push({
      productId: product.id,
      model: model.name,
      parentSku: product.sku,
      variantsBefore: beforeVariants.length,
      variantsAfter: nextProduct.variants.length,
      newVariants: addedForModel,
      parentPriceBeforeCents: product.salePriceCents,
      parentPriceAfterCents: nextProduct.salePriceCents,
      productGalleryImagesPreserved: product.images.length,
    })
  }

  if (variantsBefore !== 39 && variantsBefore !== 156 && variantsBefore < 39) {
    throw new Error(`Expected the reconciled 39 existing color SKUs or a partial/final synchronization; found ${variantsBefore} official variants`)
  }
  if (variantsAfter !== 156) throw new Error(`Synchronization would produce ${variantsAfter} official variants instead of 156`)
  const archivedOfficialProducts = officialProducts.filter(({ product }) => product.status === 'ARCHIVED').length
  const archivedHistoricalProductsPreserved = existing.filter(product => !officialIds.has(product.id) && isArchived(product)).length
  return {
    products: outputProducts,
    summary: {
      officialProducts: outputProducts.length,
      inputRows: source.length,
      variantsBefore,
      variantsAfter,
      preservedExistingVariants,
      newVariants,
      changedExistingVariants: 0,
      newSizeInventoryPositions: 0,
      promotionChanges: 0,
      variantImageAssignments: 0,
      archivedOfficialProducts,
      archivedHistoricalProductsPreserved,
      duplicateSkus: 0,
      productPriceUpdates,
    },
    diff,
    modelSummary,
  }
}
