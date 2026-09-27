import type { FulfillmentMode } from './inventory'
import type { CurrencyCode, EntityId, TenantScoped } from './shared'

export interface CommerceProduct extends TenantScoped { id: EntityId; variantId?: EntityId; name: string; variantName?: string; priceCents: number; currency: CurrencyCode; available: number; fulfillmentMode: FulfillmentMode; imageUrl?: string; externalProductId?: string; externalVariantId?: string }
export interface OrderItemRequest { productId: EntityId; variantId?: EntityId; quantity: number; discountCents?: number }
