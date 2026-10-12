import type { CommerceProduct } from '../../domain/index.js'

export function testPilotProduct(imageUrl = '/images/pilot/daniela-vino.jpeg'): CommerceProduct {
  const image = { url: imageUrl, alt: 'Imagen técnica del modelo Daniela color Vino para el fixture de prueba.' }
  return {
    tenantId: 'tenant-floes',
    id: 'pilot-daniela-test-only',
    sku: 'TEST-DANIELA-001',
    slug: 'daniela-piloto-test-only',
    name: 'Daniela (fixture de prueba)',
    description: 'Producto de prueba sin valor comercial. No representa precio, disponibilidad ni una oferta real.',
    commercialSummary: 'Fixture FLOES sandbox; todos sus datos comerciales son sintéticos.',
    category: 'Fixture de integración',
    status: 'ACTIVE',
    visibility: 'VISIBLE',
    fulfillmentMode: 'STOCK',
    pricingStatus: 'READY',
    costCents: null,
    percentage: null,
    percentageType: null,
    salePriceCents: 3999,
    promotionalPriceCents: 3499,
    currency: 'USD',
    images: [image],
    variants: [{
      id: 'pilot-daniela-vino-test-only',
      sku: 'TEST-DANIELA-VINO-001',
      color: 'Vino',
      status: 'ACTIVE',
      visibility: 'VISIBLE',
      images: [image],
      stock: 2,
      initialStockBySize: { XS: 1, S: 1, M: 2, L: 1, XL: 1 },
      fulfillmentMode: 'STOCK',
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
    }],
  }
}
