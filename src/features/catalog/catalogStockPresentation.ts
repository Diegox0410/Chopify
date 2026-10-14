import type { CommerceProduct } from '../../domain/commerce.js'

export interface CatalogStockPresentation {
  aggregateLabel: string
  aggregateValue: string
  sizeAvailabilityLabel: string
}

/** Product cards only receive product/variant aggregates, not the live size inventory ledger. */
export function catalogStockPresentation(product: CommerceProduct): CatalogStockPresentation {
  if (product.variants.length === 0) {
    return {
      aggregateLabel: 'Stock agrupado por color',
      aggregateValue: 'Sin variantes',
      sizeAvailabilityLabel: 'Pendiente de configurar',
    }
  }
  const known = product.variants.map(variant => variant.stock).filter((value): value is number => value !== null)
  const complete = known.length === product.variants.length
  const total = complete ? known.reduce((sum, value) => sum + value, 0) : null
  return {
    aggregateLabel: 'Stock agrupado por color',
    aggregateValue: total === null ? 'Pendiente de confirmar' : total === 0 ? '0 unidades' : `${total} unidades`,
    sizeAvailabilityLabel: 'No confirmada por talla',
  }
}
