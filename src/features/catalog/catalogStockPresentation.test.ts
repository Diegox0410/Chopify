import { describe, expect, it } from 'vitest'
import type { CommerceProduct } from '../../domain/commerce.js'
import { catalogStockPresentation } from './catalogStockPresentation.js'

const product = (stock: Array<number | null>): CommerceProduct => ({
  id: 'tenant-floes:model:daniela', tenantId: 'tenant-floes', sku: 'MODEL-DANIELA', slug: 'daniela',
  name: 'Daniela', description: '', commercialSummary: '', category: 'Scrubs', status: 'ACTIVE', visibility: 'VISIBLE',
  fulfillmentMode: 'STOCK', pricingStatus: 'READY', costCents: null, percentage: null, percentageType: null,
  salePriceCents: 3999, currency: 'USD', images: [], variants: stock.map((quantity, index) => ({
    id: `variant-${index}`, sku: `FLOES-DAN-${index + 1}`, color: `Color ${index + 1}`, status: 'ACTIVE', visibility: 'VISIBLE',
    images: [], stock: quantity, sizes: ['XS', 'S', 'M', 'L', 'XL'],
  })),
})

describe('Owner catalog stock presentation', () => {
  it('labels a fully known color-level total as aggregated and keeps size availability unconfirmed', () => {
    expect(catalogStockPresentation(product([50, 50, 50]))).toEqual({
      aggregateLabel: 'Stock agrupado por color',
      aggregateValue: '150 unidades',
      sizeAvailabilityLabel: 'No confirmada por talla',
    })
  })

  it('does not turn missing quantities into zero or confirmed size stock', () => {
    expect(catalogStockPresentation(product([null, null]))).toEqual({
      aggregateLabel: 'Stock agrupado por color',
      aggregateValue: 'Pendiente de confirmar',
      sizeAvailabilityLabel: 'No confirmada por talla',
    })
  })

  it('distinguishes an empty variant set from out of stock', () => {
    expect(catalogStockPresentation({ ...product([]), variants: [] })).toEqual({
      aggregateLabel: 'Stock agrupado por color',
      aggregateValue: 'Sin variantes',
      sizeAvailabilityLabel: 'Pendiente de configurar',
    })
    expect(catalogStockPresentation(product([0])).aggregateValue).toBe('0 unidades')
  })
})
