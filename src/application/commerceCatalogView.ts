import type { CommerceProduct } from '../domain/commerce.js'
import { effectiveSalePrice } from '../domain/commerce.js'
import type { BusinessCommerceAdapter } from './commercePort.js'
const money = (cents: number, currency: string) => ({ amount: cents / 100, currency })
export async function commerceCatalogView(item: CommerceProduct, commerce: BusinessCommerceAdapter) {
  const variants = await Promise.all(item.variants.filter(variant => variant.status === 'ACTIVE' && variant.visibility === 'VISIBLE').map(async variant => {
    const mode = variant.fulfillmentMode ?? item.fulfillmentMode
    const stock = await commerce.getAvailability(item.tenantId, item.id, variant.id)
    const price = variant.salePriceCents === undefined ? item.salePriceCents : variant.salePriceCents
    const available = variant.available !== false && (['MADE_TO_ORDER','SERVICE','DIGITAL','HYBRID'].includes(mode) || stock !== null && stock > 0)
    return { variantId: variant.id, name: variant.color ?? variant.sku, color: variant.color, sku: variant.sku, price: price === null ? null : money(price,item.currency), promotionalPrice: variant.promotionalPriceCents == null ? undefined : money(variant.promotionalPriceCents,item.currency), pricingStatus: effectiveSalePrice(item,variant) === null ? 'PENDING' : 'READY', available, availableQuantity: stock, availabilityStatus: stock === null ? 'NOT_CONFIGURED' : stock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK', images: variant.images, imageUrl: variant.images[0]?.url, fulfillmentMode: mode, sizes: variant.sizes, size: variant.size }
  }))
  return { productId: item.id, name: item.name, sku: item.sku, slug: item.slug, description: item.description, commercialSummary: item.commercialSummary, category: item.category, price: item.salePriceCents === null ? null : money(item.salePriceCents,item.currency), promotionalPrice: item.promotionalPriceCents == null ? undefined : money(item.promotionalPriceCents,item.currency), pricingStatus: item.pricingStatus, available: variants.length ? variants.some(variant => variant.available) : ['MADE_TO_ORDER','SERVICE','DIGITAL','HYBRID'].includes(item.fulfillmentMode), imageUrl: item.images[0]?.url, images: item.images, fulfillmentMode: item.fulfillmentMode, status: item.status, visibility: item.visibility, variants, characteristics: item.characteristics ?? [], material: item.material, collection: item.collection, gender: item.gender, ganoBotNotes: item.ganoBotNotes, sizeGuide: item.sizeGuide, sizeRecommendation: item.sizeRecommendation, exchangePolicy: item.exchangePolicy, preparationTime: item.preparationTime, deliveryType: item.deliveryType, metadata: { fulfillmentMode: item.fulfillmentMode, pricingStatus: item.pricingStatus } }
}
