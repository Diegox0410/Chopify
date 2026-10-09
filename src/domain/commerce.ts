import type { FulfillmentMode } from './inventory.js'
import type { CurrencyCode, EntityId, TenantScoped } from './shared.js'

export type ProductStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
export type ProductVisibility = 'VISIBLE' | 'HIDDEN'
export type PricingStatus = 'PENDING' | 'READY'
export type PercentageType = 'MARKUP_ON_COST' | 'GROSS_MARGIN_ON_SALE_PRICE'
export interface ProductImage { url: string; alt: string }
export interface FlatSizeRow { size: string; measurementsCm: Record<string, number> }
export interface FlatSizeGuide { measurement: 'FLAT_GARMENT_CM'; instructions: string; blouse?: readonly FlatSizeRow[]; trousers?: readonly FlatSizeRow[] }
export interface CommerceProductVariant { id: EntityId; sku: string; color: string | null; status: ProductStatus; visibility: ProductVisibility; images: readonly ProductImage[]; stock: number | null; importedStock?: number | null; initialStockBySize?: Readonly<Record<string, number | null>>; fulfillmentMode?: FulfillmentMode; salePriceCents?: number | null; promotionalPriceCents?: number | null; available?: boolean; sizes?: readonly string[]; size?: string; minimumStock?: number | null }
export interface CommerceProduct extends TenantScoped {
  id: EntityId; sku: string; slug: string; name: string; description: string; commercialSummary: string; category: string
  status: ProductStatus; visibility: ProductVisibility; fulfillmentMode: FulfillmentMode; pricingStatus: PricingStatus
  costCents: number | null; percentage: number | null; percentageType: PercentageType | null; salePriceCents: number | null; currency: CurrencyCode
  images: readonly ProductImage[]; variants: readonly CommerceProductVariant[]; externalProductId?: string
  collection?: string; gender?: string; characteristics?: readonly string[]; material?: string; ganoBotNotes?: string; internalNotes?: string
  sizeGuide?: FlatSizeGuide; sizeRecommendation?: string; preparationTime?: string; deliveryType?: string
  exchangePolicy?: { allowed: boolean | null; conditions: string }; promotionalPriceCents?: number | null
}
export interface OrderItemRequest { productId: EntityId; variantId?: EntityId; size?: string; quantity: number; discountCents?: number }
export function effectiveSalePrice(product: CommerceProduct, variant?: CommerceProductVariant): number | null { const base = variant?.salePriceCents === undefined ? product.salePriceCents : variant.salePriceCents; return base === null ? null : variant?.promotionalPriceCents ?? product.promotionalPriceCents ?? base }
export function isCommerciallyVisible(product: CommerceProduct): boolean { return product.status === 'ACTIVE' && product.visibility === 'VISIBLE' }
export function validateCommerceProduct(product: CommerceProduct): void {
  if (!product.id.trim() || !product.sku.trim() || !product.slug.trim() || !product.name.trim()) throw new Error('Product identity is required')
  if (!/^[A-Z]{3}$/.test(product.currency)) throw new Error('Product currency must be an explicit ISO code')
  if (product.pricingStatus === 'READY' && (product.salePriceCents === null || product.salePriceCents <= 0)) throw new Error('READY pricing requires a positive sale price')
  if (product.pricingStatus === 'PENDING' && product.salePriceCents !== null) throw new Error('PENDING pricing cannot expose a sale price')
  for (const cents of [product.costCents, product.salePriceCents]) if (cents !== null && (!Number.isInteger(cents) || cents < 0)) throw new Error('Money values must be non-negative integer cents or null')
  if (product.percentage !== null && (!Number.isFinite(product.percentage) || product.percentage < 0)) throw new Error('Percentage must be non-negative or null')
  if ((product.percentage === null) !== (product.percentageType === null)) throw new Error('Percentage value and type must be configured together')
  if (!['ACTIVE','DRAFT','ARCHIVED'].includes(product.status) || !['VISIBLE','HIDDEN'].includes(product.visibility) || !['STOCK','MADE_TO_ORDER','HYBRID','SERVICE','DIGITAL'].includes(product.fulfillmentMode)) throw new Error('Invalid product state or fulfillment mode')
  const checkPromotion = (promotion: number | null | undefined, base: number | null) => { if (promotion != null && (!Number.isInteger(promotion) || promotion <= 0 || base === null || promotion >= base)) throw new Error('Promotion must be positive and lower than sale price') }
  checkPromotion(product.promotionalPriceCents, product.salePriceCents)
  for (const variant of product.variants) { checkPromotion(variant.promotionalPriceCents, variant.salePriceCents === undefined ? product.salePriceCents : variant.salePriceCents); if (!['ACTIVE','DRAFT','ARCHIVED'].includes(variant.status) || !['VISIBLE','HIDDEN'].includes(variant.visibility)) throw new Error('Invalid variant state'); if (variant.sizes && (!Array.isArray(variant.sizes) || variant.sizes.some(size => typeof size !== 'string' || !size.trim()))) throw new Error('Invalid sizes'); if (variant.initialStockBySize && Object.entries(variant.initialStockBySize).some(([size, stock]) => !size.trim() || (stock !== null && (!Number.isInteger(stock) || stock < 0)))) throw new Error('Initial stock by size must contain non-negative integers or null') }
  const ids = new Set<string>(); const skus = new Set<string>()
  for (const variant of product.variants) { if (!variant.id.trim() || !variant.sku.trim()) throw new Error('Variant identity is required'); if (ids.has(variant.id) || skus.has(variant.sku)) throw new Error('Variant ids and SKUs must be unique within a product'); ids.add(variant.id); skus.add(variant.sku); if (variant.stock !== null && (!Number.isInteger(variant.stock) || variant.stock < 0)) throw new Error('Variant stock must be a non-negative integer or null'); if (variant.salePriceCents !== undefined && variant.salePriceCents !== null && (!Number.isInteger(variant.salePriceCents) || variant.salePriceCents <= 0)) throw new Error('Variant sale price must be positive or null') }
}
