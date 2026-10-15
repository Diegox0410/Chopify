import type { CommerceProduct } from '../domain/commerce.js'
import { effectiveSalePrice } from '../domain/commerce.js'
import type { BusinessCommerceAdapter } from './commercePort.js'
const money = (cents: number, currency: string | null) => {
  if (!currency) throw new Error('Product price exists without a confirmed currency')
  return { amount: cents / 100, currency }
}
export async function commerceCatalogView(item: CommerceProduct, commerce: BusinessCommerceAdapter) {
  // Never apply one model's size measurements to another model. Missing approved
  // measurements remain absent so the storefront/bot can ask for human guidance.
  const sizeGuide = item.sizeGuide
  const variants = await Promise.all(item.variants.filter(variant => variant.status === 'ACTIVE' && variant.visibility === 'VISIBLE').map(async variant => {
    const mode = variant.fulfillmentMode ?? item.fulfillmentMode
    const regularPriceCents = variant.salePriceCents === undefined ? item.salePriceCents : variant.salePriceCents
    const stock = await commerce.getAvailability(item.tenantId, item.id, variant.id)
    const sizes = [...new Set([...(variant.sizes ?? []), ...(variant.size ? [variant.size] : [])])]
    const sizeAvailability = await Promise.all(sizes.map(async size => {
      const availableQuantity = await commerce.getAvailability(item.tenantId, item.id, variant.id, size)
      return { size, availableQuantity, available: availableQuantity !== null && availableQuantity > 0, availabilityStatus: availableQuantity === null ? 'NOT_CONFIGURED' as const : availableQuantity > 0 ? 'AVAILABLE' as const : 'OUT_OF_STOCK' as const }
    }))
    const price = variant.salePriceCents === undefined ? item.salePriceCents : variant.salePriceCents
    const floesSizeScoped = item.tenantId === 'tenant-floes' && sizes.length > 0 && mode === 'STOCK'
    const confirmedSizeQuantities = sizeAvailability.map(entry => entry.availableQuantity)
    const confirmedQuantity = floesSizeScoped
      ? confirmedSizeQuantities.some(value => value !== null) ? confirmedSizeQuantities.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null
      : stock
    const inventoryVerified = mode === 'STOCK'
      ? sizes.length ? sizeAvailability.some(entry => entry.availableQuantity !== null) : stock !== null
      : variant.inventoryVerified === true
    const available = mode === 'STOCK'
      ? inventoryVerified && variant.available !== false && (floesSizeScoped ? sizeAvailability.some(entry => entry.available) : stock !== null && stock > 0)
      : variant.available !== false && (['MADE_TO_ORDER','SERVICE','DIGITAL','HYBRID'].includes(mode) || stock !== null && stock > 0)
    return { variantId: variant.id, name: variant.color ?? variant.sku, color: variant.color, pantsType: variant.pantsType ?? null, sku: variant.sku, regularPrice: regularPriceCents === null ? null : money(regularPriceCents,item.currency), price: price === null ? null : money(price,item.currency), promotionalPrice: variant.promotionalPriceCents == null ? undefined : money(variant.promotionalPriceCents,item.currency), pricingStatus: effectiveSalePrice(item,variant) === null ? 'PENDING' : 'READY', available, inventoryVerified, availableQuantity: confirmedQuantity, availabilityStatus: confirmedQuantity === null ? 'NOT_CONFIGURED' : confirmedQuantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK', reportedStockQuantity: stock, stockScope: floesSizeScoped ? confirmedQuantity === null ? 'COLOR_AGGREGATE_UNCONFIRMED' : 'SIZE_CONFIRMED' : 'VARIANT', images: variant.images, imageUrl: variant.images[0]?.url, fulfillmentMode: mode, sizes, size: variant.size, sizeAvailability }
  }))
  return { productId: item.id, name: item.name, sku: item.sku, slug: item.slug, description: item.description, commercialSummary: item.commercialSummary, category: item.category, price: item.salePriceCents === null ? null : money(item.salePriceCents,item.currency), promotionalPrice: item.promotionalPriceCents == null ? undefined : money(item.promotionalPriceCents,item.currency), pricingStatus: item.pricingStatus, available: variants.length ? variants.some(variant => variant.available) : ['MADE_TO_ORDER','SERVICE','DIGITAL','HYBRID'].includes(item.fulfillmentMode), imageUrl: item.images[0]?.url, images: item.images, fulfillmentMode: item.fulfillmentMode, status: item.status, visibility: item.visibility, variants, characteristics: item.characteristics ?? [], material: item.material, collection: item.collection, gender: item.gender, ganoBotNotes: item.ganoBotNotes, sizeGuide, sizeRecommendation: item.sizeRecommendation, exchangePolicy: item.exchangePolicy, preparationTime: item.preparationTime, deliveryType: item.deliveryType, metadata: { fulfillmentMode: item.fulfillmentMode, pricingStatus: item.pricingStatus } }
}
