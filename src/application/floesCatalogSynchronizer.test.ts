import { describe, expect, it } from 'vitest'
import type { CommerceProduct, CommerceProductVariant } from '../domain/commerce.js'
import { FLOES_OFFICIAL_MODELS, prepareFloesCatalogSync } from './floesCatalogSynchronizer.js'
import { commerceCatalogView } from './commerceCatalogView.js'
import type { BusinessCommerceAdapter } from './commercePort.js'

const colors = [
  'Azul marino', 'Negro', 'Palo Rosa', 'Blanco', 'Celeste', 'Azul Electrico', 'Gris',
  'Verde Petroleo', 'Verde militar', 'Lila', 'Vino', 'Verde Quirurgico', 'Caqui',
]
const codes: Record<string, string> = {
  daniela: 'DAN', 'maria-jose': 'MJ', elite: 'ELI', maemi: 'MAE', esperanza: 'ESP', klit: 'KLI',
  florma: 'FLOR', girasol: 'GIRA', bruni: 'BRU', laly: 'LAL', esencial: 'ESE', mabe: 'MABE',
}
const prices: Record<string, number> = {
  daniela: 3999, 'maria-jose': 4699, elite: 4299, maemi: 4999, esperanza: 3999, klit: 4499,
  florma: 4299, girasol: 3999, bruni: 4299, laly: 4299, esencial: 3999, mabe: 4399,
}
const skuFor = (slug: string, index: number) => {
  const serial = slug === 'maria-jose' ? String(index + 1).padStart(3, '0') : String(index + 1).padStart(2, '0')
  return `FLOES-${codes[slug]}-${serial}`
}
const rowFor = (model: typeof FLOES_OFFICIAL_MODELS[number], index: number) => ({
  nombre_producto: `Modelo ${model.name}`,
  sku: skuFor(model.slug, index),
  color: colors[index],
  talla: 'Xs-S-M-L-XL',
  precio_venta: prices[model.slug] / 100,
  precio_promocional: prices[model.slug] / 100 - 500,
  moneda: 'USD',
  stock_individual_por_talla_y_por_color: '10',
  imagen_1: `C:\\legacy\\${model.slug}\\${colors[index]}.jpeg`,
})

function fixture() {
  const existing = FLOES_OFFICIAL_MODELS.map((model, modelIndex): CommerceProduct => {
    const hasExistingVariants = modelIndex < 3
    const variants: CommerceProductVariant[] = hasExistingVariants ? colors.map((color, index) => ({
      id: `variant-${model.slug}-${index + 1}`,
      sku: skuFor(model.slug, index),
      color,
      status: 'ACTIVE',
      visibility: 'VISIBLE',
      images: [{ url: `https://assets.example/${model.slug}/${index}.jpg`, alt: model.name }],
      stock: 50,
      importedStock: 50,
      salePriceCents: prices[model.slug],
      promotionalPriceCents: null,
      available: true,
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
      fulfillmentMode: 'STOCK',
    })) : []
    return {
      id: model.id,
      tenantId: 'tenant-floes',
      sku: model.parentSku,
      slug: model.slug,
      name: model.name,
      description: `Descripción conservada ${model.name}`,
      commercialSummary: `Resumen conservado ${model.name}`,
      category: 'Scrubs',
      status: 'ACTIVE',
      visibility: 'VISIBLE',
      fulfillmentMode: 'STOCK',
      pricingStatus: hasExistingVariants ? 'READY' : 'PENDING',
      costCents: null,
      percentage: null,
      percentageType: null,
      salePriceCents: hasExistingVariants ? prices[model.slug] : null,
      currency: hasExistingVariants ? 'USD' : null,
      images: Array.from({ length: model.slug === 'girasol' ? 6 : 3 }, (_, index) => ({ url: `https://assets.example/${model.slug}/gallery-${index}.jpg`, alt: model.name })),
      variants,
    }
  })
  const historical = ['Scrub Esencial', 'Scrub María José', 'Scrub María Belén', 'Chaqueta María José'].map((name, index): CommerceProduct => ({
    ...existing[0],
    id: `legacy-${index}`,
    sku: `LEGACY-${index}`,
    name,
    slug: `legacy-${index}`,
    status: 'ARCHIVED',
    visibility: 'HIDDEN',
    currency: 'COP',
    variants: [],
  }))
  const source = FLOES_OFFICIAL_MODELS.flatMap(model => colors.map((_, index) => rowFor(model, index)))
  return { source, existing: [...existing, ...historical] }
}

describe('FLOES safe catalog synchronizer', () => {
  it('preserves the 39 existing SKUs and prepares exactly 117 new color SKUs without inventing stock, promotions, or images', () => {
    const { source, existing } = fixture()
    const beforeOfficial = structuredClone(existing.slice(0, 12))
    const beforeHistorical = structuredClone(existing.slice(12))
    const result = prepareFloesCatalogSync(source, existing)

    expect(result.summary).toMatchObject({
      officialProducts: 12,
      inputRows: 156,
      variantsBefore: 39,
      variantsAfter: 156,
      preservedExistingVariants: 39,
      newVariants: 117,
      changedExistingVariants: 0,
      newSizeInventoryPositions: 0,
      promotionChanges: 0,
      variantImageAssignments: 0,
      archivedOfficialProducts: 0,
      archivedHistoricalProductsPreserved: 4,
      duplicateSkus: 0,
    })
    expect(result.products.map(product => product.id)).toEqual(beforeOfficial.map(product => product.id))
    expect(result.diff).toHaveLength(117)
    expect(new Set(result.diff.map(entry => entry.newSku)).size).toBe(117)
    expect(result.diff.every(entry => entry.stock === null && entry.promotionalPriceCents === null && entry.images === 0)).toBe(true)
    expect(result.products.slice(0, 3).map(product => product.variants)).toEqual(beforeOfficial.slice(0, 3).map(product => product.variants))
    expect(result.products.flatMap(product => product.variants.slice(product.id.includes('daniela') || product.id.includes('maria-jose') || product.id.includes('elite') ? 13 : 0))).toHaveLength(117)
    expect(result.products.filter(product => product.currency === 'USD')).toHaveLength(12)
    expect(result.products.every(product => product.images.length === beforeOfficial.find(old => old.id === product.id)?.images.length)).toBe(true)
    expect(existing.slice(12)).toEqual(beforeHistorical)

    const newVariants = result.products.flatMap(product => product.variants).filter(variant => variant.stock === null)
    expect(newVariants).toHaveLength(117)
    expect(newVariants.every(variant => !variant.initialStockBySize && variant.available === false && variant.images.length === 0)).toBe(true)
    expect(newVariants.every(variant => variant.promotionalPriceCents === null)).toBe(true)
  })

  it('is idempotent when run a second time against the prepared state', () => {
    const { source, existing } = fixture()
    const first = prepareFloesCatalogSync(source, existing)
    const afterFirst = existing.map(product => first.products.find(updated => updated.id === product.id) ?? product)
    const second = prepareFloesCatalogSync(source, afterFirst)
    expect(second.summary.variantsBefore).toBe(156)
    expect(second.summary.variantsAfter).toBe(156)
    expect(second.summary.newVariants).toBe(0)
    expect(second.summary.preservedExistingVariants).toBe(156)
    expect(second.diff).toEqual([])
    expect(second.products).toEqual(first.products)
  })

  it('keeps the Chopify catalog view compatible with GanoBot while size inventory is unknown', async () => {
    const { source, existing } = fixture()
    const prepared = prepareFloesCatalogSync(source, existing)
    const maemi = prepared.products.find(product => product.slug === 'maemi')!
    const view = await commerceCatalogView(maemi, {
      getAvailability: async () => null,
    } as unknown as BusinessCommerceAdapter)
    expect(view.name).toBe('Maemi')
    expect(view.imageUrl).toBe(maemi.images[0].url)
    expect(view.price).toEqual({ amount: 49.99, currency: 'USD' })
    expect(view.promotionalPrice).toBeUndefined()
    expect(view.available).toBe(false)
    expect(view.variants).toHaveLength(13)
    expect(view.variants.every(variant => variant.available === false && variant.pricingStatus === 'READY')).toBe(true)
    expect(view.variants.every(variant => variant.inventoryVerified === false && variant.pantsType === null)).toBe(true)
    expect(view.variants.every(variant => variant.sizeAvailability.every(size => size.availabilityStatus === 'NOT_CONFIGURED'))).toBe(true)
    expect(view.variants.every(variant => variant.images.length === 0)).toBe(true)
  })

  it('passes pants type and only confirms stock when every applicable size is verified', async () => {
    const { source, existing } = fixture()
    const prepared = prepareFloesCatalogSync(source, existing)
    const product = prepared.products.find(item => item.slug === 'maemi')!
    const colorVariant = { ...product.variants[0], pantsType: 'Jogger', inventoryVerified: true, available: true }
    const view = await commerceCatalogView({ ...product, variants: [colorVariant] }, {
      getAvailability: async (_tenant, _product, _variant, size) => size ? 2 : 10,
    } as unknown as BusinessCommerceAdapter)
    expect(view.variants[0]).toMatchObject({ pantsType: 'Jogger', inventoryVerified: true, available: true, sku: colorVariant.sku })
    expect(view.variants[0].sizeAvailability.every(size => size.availableQuantity === 2)).toBe(true)
  })

  it('refuses mismatched existing SKU data and archived official products', () => {
    const { source, existing } = fixture()
    const wrongColor = structuredClone(existing)
    wrongColor[0].variants[0].color = 'Negro'
    expect(() => prepareFloesCatalogSync(source, wrongColor)).toThrow(/Color mismatch/)

    const archivedOfficial = structuredClone(existing)
    archivedOfficial[0].status = 'ARCHIVED'
    expect(() => prepareFloesCatalogSync(source, archivedOfficial)).toThrow(/Official product is archived/)
  })

  it('refuses product promotions instead of activating unapproved workbook promotions', () => {
    const { source, existing } = fixture()
    const productWithPromo = structuredClone(existing)
    productWithPromo[3].promotionalPriceCents = prices.maemi - 500
    expect(() => prepareFloesCatalogSync(source, productWithPromo)).toThrow(/Product promotion requires approval/)
  })
})
