import type { CommerceProduct, InventoryPosition, InventoryReservationItem } from '../domain'

export interface BusinessCommerceAdapter {
  searchProducts(tenantId: string, query: string): Promise<readonly CommerceProduct[]>
  getProduct(tenantId: string, productId: string, variantId?: string): Promise<CommerceProduct | null>
  getPrice(tenantId: string, productId: string, variantId?: string): Promise<{ priceCents: number; currency: string } | null>
  getAvailability(tenantId: string, productId: string, variantId?: string): Promise<number>
  reserveInventory(tenantId: string, items: readonly InventoryReservationItem[]): Promise<readonly InventoryPosition[]>
  releaseInventory(tenantId: string, items: readonly InventoryReservationItem[]): Promise<readonly InventoryPosition[]>
  commitInventory(tenantId: string, items: readonly InventoryReservationItem[]): Promise<readonly InventoryPosition[]>
  publishOrderReference(tenantId: string, orderId: string): Promise<void>
}
