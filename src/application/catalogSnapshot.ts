import type { CommerceProduct } from '../domain/commerce.js'
import type { InventoryPosition } from '../domain/index.js'

/** A restore-capable catalog projection. It deliberately contains no customers or orders. */
export interface OwnerCatalogSnapshot {
  schemaVersion: 2
  canonical: true
  tenantId: string
  capturedAt: string
  stateVersion: string | null
  products: CommerceProduct[]
  inventory: InventoryPosition[]
  paymentConfiguration: null
  paymentConfigurationStatus: 'NOT_STORED_IN_COMMERCE_STATE'
}
export function createOwnerCatalogSnapshot(input: {
  tenantId: string; capturedAt: string; stateVersion: string | null
  products: readonly CommerceProduct[]; inventory: readonly InventoryPosition[]
}): OwnerCatalogSnapshot {
  if ([...input.products, ...input.inventory].some(row => row.tenantId !== input.tenantId)) {
    throw new Error('Catalog snapshot contains cross-tenant records')
  }
  if (new Set(input.products.map(product => product.id)).size !== input.products.length) {
    throw new Error('Catalog snapshot contains duplicate product identifiers')
  }
  return { schemaVersion: 2, canonical: true, ...structuredClone(input), products: structuredClone([...input.products]),
    inventory: structuredClone([...input.inventory]), paymentConfiguration: null, paymentConfigurationStatus: 'NOT_STORED_IN_COMMERCE_STATE' }
}
