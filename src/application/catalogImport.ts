import type { CommerceProduct, CommerceProductVariant, FlatSizeGuide, ProductImage } from '../domain/commerce.js'
import { validateCommerceProduct } from '../domain/commerce.js'
import type { FulfillmentMode } from '../domain/inventory.js'

export type CatalogRow = Record<string, unknown>
export interface CatalogIssue { row: number; field: string; message: string; severity: 'ERROR' | 'WARNING' }
export interface CatalogPreview { products: CommerceProduct[]; issues: CatalogIssue[]; summary: { rows: number; validRows: number; newProducts: number; newVariants: number; updates: number; duplicateSkus: number; imagesFound: number; imagesMissing: number } }
export const normalizeCatalogKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const normalizeImagePath = (value: string) => value.replace(/\\/g, '/').split('/').map(part => normalizeCatalogKey(part.replace(/\.(jpeg|jpg|png|webp)$/i, ''))).filter(Boolean).join('/')
const text = (value: unknown) => value == null ? '' : String(value).trim()
const skuKey = (value: string) => value.trim().toUpperCase()
const fields = (row: CatalogRow) => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeCatalogKey(key).replace(/-/g, '_'), value]))
const nonempty = (value: unknown) => text(value) !== ''
function resolveImages(row: CatalogRow, model: string, name: string, color: string, normalizedImages: Array<{ path: string; url: string }>, result: CatalogPreview, rowNumber: number, issue: (row: number, field: string, message: string, severity?: CatalogIssue['severity']) => void): ProductImage[] {
  const images: ProductImage[] = []
  const references = Array.from({ length: 6 }, (_, index) => row[`imagen_${index + 1}`]).map(text).filter(Boolean)
  if (!references.length && color) references.push(`${model}/${color}.jpeg`)
  for (const reference of references) {
    let url: string | undefined
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(reference) && !/^https:\/\//i.test(reference)) throw new Error('Las URLs de imagen deben usar HTTPS')
    if (/^https:\/\//i.test(reference)) { const parsed = new URL(reference); if (parsed.username || parsed.password || !parsed.hostname) throw new Error('URL de imagen inválida'); url = parsed.href }
    else {
      if (/^(?:file:|\/\/)/i.test(reference)) throw new Error('URL de imagen inválida')
      const portable = /^[a-z]:/i.test(reference) ? reference.replace(/\\/g, '/').split('/').slice(-2).join('/') : reference
      const normalized = normalizeImagePath(portable)
      let matches = normalizedImages.filter(image => image.path === normalized || image.path.endsWith(`/${normalized}`))
      if (!normalized.includes('/')) matches = matches.filter(image => image.path.includes(`${model}/`))
      if (matches.length > 1) throw new Error(`Imagen ambigua: ${reference}`)
      url = matches[0]?.url
    }
    if (url && /^https:\/\//.test(url)) { images.push({ url, alt: `${name}${color ? ` · ${color}` : ''}` }); result.summary.imagesFound++ }
    else { result.summary.imagesMissing++; issue(rowNumber, 'imagen', `Imagen no encontrada: ${reference}`, 'WARNING') }
  }
  return images
}
function decimal(value: unknown): number | null {
  if (!nonempty(value)) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  let input = text(value).replace(/[$€\s]/g, '')
  if (input.includes(',') && input.includes('.')) input = input.lastIndexOf(',') > input.lastIndexOf('.') ? input.replace(/\./g, '').replace(',', '.') : input.replace(/,/g, '')
  else input = input.replace(',', '.')
  return /^[+-]?\d+(\.\d+)?$/.test(input) ? Number(input) : NaN
}
function boolean(value: unknown): boolean | null {
  const key = normalizeCatalogKey(text(value))
  if (!key) return null
  if (['si','true','1','yes','activo','disponible'].includes(key)) return true
  if (['no','false','0','inactivo','no-disponible'].includes(key)) return false
  throw new Error('Usa sí/no o true/false')
}
export function parseFlatSizeGuide(value: unknown): FlatSizeGuide | undefined {
  const input = text(value)
  if (!input) return undefined
  const instructions = 'Mide horizontalmente una prenda que te quede bien, extendida sobre una superficie plana. Compara medidas planas en centímetros; no son contornos corporales y no se multiplican por dos. Si estás entre tallas, consulta tu preferencia de ajuste. No garantiza ajuste perfecto.'
  if (!input.startsWith('{')) return { measurement: 'FLAT_GARMENT_CM', instructions: `${instructions}\n${input}` }
  const parsed = JSON.parse(input) as FlatSizeGuide
  if (parsed.measurement !== 'FLAT_GARMENT_CM') throw new Error('La guía debe usar FLAT_GARMENT_CM')
  for (const part of [parsed.blouse, parsed.trousers]) if (part) for (const row of part) if (!row.size || !row.measurementsCm || Object.values(row.measurementsCm).some(number => typeof number !== 'number' || !Number.isFinite(number) || number <= 0)) throw new Error('Medidas planas inválidas')
  return { ...parsed, instructions: `${instructions}\n${parsed.instructions ?? ''}` }
}
function mode(value: unknown): FulfillmentMode {
  const key = normalizeCatalogKey(text(value))
  if (['stock','inmediato','inmediata','entrega-inmediata'].includes(key)) return 'STOCK'
  if (['made-to-order','bajo-pedido','sobre-pedido','por-pedido','pedido','confeccion'].includes(key)) return 'MADE_TO_ORDER'
  if (['hybrid','hibrido'].includes(key)) return 'HYBRID'
  // The master template uses this column for delivery channels, not production mode.
  // STOCK is conservative: an empty stock can never be purchased or claimed available.
  if (/servientrega|retiro|delivery|entrega|envio/.test(key)) return 'STOCK'
  throw new Error('tipo_entrega debe indicar STOCK o bajo pedido; no se infiere disponibilidad')
}

/** Pure preview shared by admin, CLI and the authenticated server. Never trusts a client-built product. */
export function previewCatalogImport(tenantId: string, source: readonly CatalogRow[], existing: readonly CommerceProduct[] = [], imageUrls: Record<string, string> = {}): CatalogPreview {
  if (tenantId !== 'tenant-floes') throw new Error('La importación FLOES está restringida a tenant-floes')
  if (!source.length || source.length > 5000) throw new Error('El archivo debe contener entre 1 y 5000 filas')
  if (existing.some(product => product.tenantId !== tenantId)) throw new Error('Cross-tenant catalog rejected')
  const result: CatalogPreview = { products: [], issues: [], summary: { rows: source.length, validRows: 0, newProducts: 0, newVariants: 0, updates: 0, duplicateSkus: 0, imagesFound: 0, imagesMissing: 0 } }
  const groups = new Map<string, CommerceProduct>()
  const seen = new Set<string>()
  const normalizedImages = Object.entries(imageUrls).map(([path, url]) => ({ path: normalizeImagePath(path), url }))
  const issue = (row: number, field: string, message: string, severity: CatalogIssue['severity'] = 'ERROR') => result.issues.push({ row, field, message, severity })
  source.forEach((raw, index) => {
    const rowNumber = Number(raw.__row) || index + 2
    const row = fields(raw)
    const name = text(row.nombre_producto), sku = text(row.sku), color = text(row.color)
    const model = normalizeCatalogKey(name.replace(/^modelo\s+/i, ''))
    if (!name || !model) { issue(rowNumber, 'nombre_producto', 'Nombre del producto obligatorio'); return }
    if (!sku) {
      try {
        const requestedProductSku = text(row.sku_producto)
        const modelMatches = existing.filter(product => normalizeCatalogKey(product.name.replace(/^modelo\s+/i, '')) === model || product.slug === model)
        if (modelMatches.length > 1) throw new Error('Hay más de un producto existente para este modelo; requiere reconciliación Owner antes de importar')
        const base = modelMatches[0]
        const productSku = requestedProductSku || base?.sku || ''
        if (!productSku) throw new Error('sku_producto es obligatorio para un modelo nuevo; no se generará un SKU automáticamente')
        if (base && requestedProductSku && skuKey(requestedProductSku) !== skuKey(base.sku)) throw new Error('sku_producto no coincide con el SKU principal existente')
        const skuCollision = existing.some(product => {
          if (product.id === base?.id) return product.variants.some(variant => skuKey(variant.sku) === skuKey(productSku))
          return [product.sku, ...product.variants.map(variant => variant.sku)].some(existingSku => skuKey(existingSku) === skuKey(productSku))
        })
        if (skuCollision) throw new Error(`El SKU principal ${productSku} ya pertenece a otro registro comercial`)
        const hasVariantData = [color, row.talla, row.stock_actual, row.stock_por_talla_json, row.stock_individual_por_talla_y_por_color, row.precio_venta, row.precio_promocional, row.disponible].some(nonempty)
        if (hasVariantData) throw new Error('Una ficha informativa sin variantes no puede incluir color, talla, precio, stock ni disponibilidad')
        if (seen.has(skuKey(productSku))) { result.summary.duplicateSkus++; throw new Error(`SKU principal repetido: ${productSku}`) }
        seen.add(skuKey(productSku))
        const requestedActive = boolean(row.activo)
        if (requestedActive === null) throw new Error('activo es obligatorio')
        const images = resolveImages(row, model, name, '', normalizedImages, result, rowNumber, issue)
        const currency = base?.currency ?? (text(row.moneda).toUpperCase() || null)
        if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw new Error('moneda debe contener un código ISO explícito o permanecer pendiente')
        if (base && currency !== base.currency && text(row.moneda)) throw new Error('Una ficha informativa no puede modificar la moneda de un producto existente')
        const id = base?.id ?? `${tenantId}:model:${model}`
        if (!base && existing.some(product => product.id === id)) throw new Error('El identificador determinista ya pertenece a un registro distinto')
        const product: CommerceProduct = {
          ...(base ?? {}), id, tenantId, sku: productSku, slug: base?.slug ?? model, name,
          description: text(row.descripcion) || base?.description || '', commercialSummary: text(row.descripcion) || base?.commercialSummary || '', category: text(row.categoria) || base?.category || '',
          // Informational imports update only editorial fields on an existing record. In particular,
          // they must not change commercial state, price, fulfillment, or linked variants.
          status: base?.status ?? (requestedActive ? 'ACTIVE' : 'DRAFT'),
          visibility: base?.visibility ?? (requestedActive ? 'VISIBLE' : 'HIDDEN'),
          fulfillmentMode: base?.fulfillmentMode ?? 'STOCK',
          pricingStatus: base?.pricingStatus ?? 'PENDING',
          costCents: base?.costCents ?? null, percentage: base?.percentage ?? null, percentageType: base?.percentageType ?? null,
          salePriceCents: base?.salePriceCents ?? null, currency,
          images: images.length ? images : base?.images ?? [],
          // Keep existing variants byte-for-byte equivalent; information-only rows contain no variant data.
          variants: base?.variants ?? [],
          collection: text(row.coleccion) || base?.collection, gender: text(row.genero) || base?.gender,
          characteristics: text(row.caracteristicas).split(/[;|\\n]+/).map(value => value.trim()).filter(Boolean).length ? text(row.caracteristicas).split(/[;|\\n]+/).map(value => value.trim()).filter(Boolean) : base?.characteristics,
          material: text(row.material) || base?.material, ganoBotNotes: text(row.notas_ganobot) || base?.ganoBotNotes,
          internalNotes: text(row.notas_internas) || base?.internalNotes, sizeGuide: base?.sizeGuide,
          sizeRecommendation: text(row.recomendacion_talla) || base?.sizeRecommendation,
          preparationTime: base?.preparationTime, deliveryType: base?.deliveryType,
          exchangePolicy: base?.exchangePolicy ?? { allowed: null, conditions: '' },
        }
        if (!base) delete product.promotionalPriceCents
        validateCommerceProduct(product)
        groups.set(id, product)
        result.summary.validRows++
        if (base) result.summary.updates++
        result.issues.push({ row: rowNumber, field: 'variantes/precio/stock', message: 'Ficha informativa: no crea variantes ni inventario; la compra permanece bloqueada hasta confirmar datos comerciales.', severity: 'WARNING' })
      } catch (cause) { issue(rowNumber, 'fila', cause instanceof Error ? cause.message : 'Fila inválida') }
      return
    }
    if (!sku) { issue(rowNumber, 'sku', 'SKU de variante obligatorio'); return }
    if (seen.has(skuKey(sku))) { result.summary.duplicateSkus++; issue(rowNumber, 'sku', `SKU repetido: ${sku}`); return }
    seen.add(skuKey(sku))
    try {
      const existingBySku = existing.find(product => product.variants.some(variant => skuKey(variant.sku) === skuKey(sku)))
      const base = existingBySku ?? existing.find(product => normalizeCatalogKey(product.name.replace(/^modelo\s+/i, '')) === model || product.slug === model)
      const requestedProductSku = text(row.sku_producto)
      const productSku = requestedProductSku || base?.sku || ''
      if (!productSku) throw new Error('sku_producto es obligatorio para un modelo nuevo; no se generará un SKU automáticamente')
      if (base && requestedProductSku && skuKey(requestedProductSku) !== skuKey(base.sku)) throw new Error('sku_producto no coincide con el SKU principal existente')
      if (skuKey(productSku) === skuKey(sku)) throw new Error('El SKU principal debe ser distinto del SKU de variante')
      const currency = text(row.moneda).toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('moneda debe contener un código ISO explícito')
      const requestedActive = boolean(row.activo), available = boolean(row.disponible)
      if (requestedActive === null) throw new Error('activo es obligatorio')
      const fulfillmentMode = mode(row.tipo_entrega)
      const hasIndividualSizeColorStock = nonempty(row.stock_individual_por_talla_y_por_color)
      const hasSizeStockMap = nonempty(row.stock_por_talla_json)
      const sizes = [...new Set(text(row.talla).split(/[,;|/\s-]+/).map(size => size.trim().toUpperCase()).filter(Boolean))]
      const stockPerSize = hasIndividualSizeColorStock ? decimal(row.stock_individual_por_talla_y_por_color) : null
      if (hasIndividualSizeColorStock && hasSizeStockMap) throw new Error('Usa stock_por_talla_json o stock_individual_por_talla_y_por_color, no ambos')
      let initialStockBySize: Record<string, number> | undefined
      if (hasSizeStockMap) {
        let parsed: unknown
        try { parsed = JSON.parse(text(row.stock_por_talla_json)) }
        catch { throw new Error('stock_por_talla_json debe ser un objeto JSON de talla a unidades') }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('stock_por_talla_json debe ser un objeto JSON de talla a unidades')
        const entries = Object.entries(parsed as Record<string, unknown>).map(([size, value]) => [size.trim().toUpperCase(), decimal(value)] as const)
        const keys = entries.map(([size]) => size)
        if (!sizes.length || keys.length !== sizes.length || new Set(keys).size !== keys.length || sizes.some(size => !keys.includes(size)) || keys.some(size => !sizes.includes(size))) {
          throw new Error('stock_por_talla_json debe incluir exactamente cada talla indicada, sin duplicados')
        }
        if (entries.some(([, value]) => value === null || !Number.isInteger(value) || value < 0)) throw new Error('Cada stock por talla debe ser un entero no negativo')
        initialStockBySize = Object.fromEntries(entries as Array<readonly [string, number]>)
      } else if (hasIndividualSizeColorStock && stockPerSize !== null && sizes.length) {
        initialStockBySize = Object.fromEntries(sizes.map(size => [size, stockPerSize]))
      }
      const stock = initialStockBySize
        ? Object.values(initialStockBySize).reduce((total, quantity) => total + quantity, 0)
        : hasIndividualSizeColorStock ? null : decimal(row.stock_actual)
      const minimumStock = decimal(row.stock_minimo)
      for (const count of [stockPerSize, stock, minimumStock]) if (count !== null && (!Number.isInteger(count) || count < 0)) throw new Error('Stock debe ser entero no negativo o vacío')
      if (hasIndividualSizeColorStock && stockPerSize !== null && !sizes.length) throw new Error('El stock individual por talla y color requiere al menos una talla')
      const sale = decimal(row.precio_venta), promotion = decimal(row.precio_promocional), cost = decimal(row.costo_unitario)
      for (const amount of [sale, promotion, cost]) if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error('Precio/costo inválido')
      if (sale !== null && sale <= 0) throw new Error('precio_venta debe ser mayor que cero o vacío')
      const cents = (amount: number | null) => amount === null ? null : Math.round(amount * 100)
      if (existing.some(product => skuKey(product.sku) === skuKey(sku))) throw new Error('SKU de variante coincide con SKU de producto padre')
      const groupKey = base?.id ?? `${tenantId}:model:${model}`
      const working = groups.get(groupKey)
      if (working && working.currency !== currency) throw new Error('Todas las variantes del modelo deben usar la misma moneda')
      const images = resolveImages(row, model, name, color, normalizedImages, result, rowNumber, issue)
      const previousVariant = base?.variants.find(variant => skuKey(variant.sku) === skuKey(sku))
      const purchaseAvailability = fulfillmentMode === 'STOCK' ? stock !== null && stock > 0 : available ?? false
      // Publication and purchase readiness are separate. A visible catalog card may be
      // published while its price/stock is pending; checkout remains blocked downstream.
      const readyForPurchase = sale !== null && (fulfillmentMode === 'STOCK' ? stock !== null : available === true)
      const active = requestedActive === true
      const pantsType = text(row.tipo_pantalon ?? row.pants_type) || previousVariant?.pantsType || null
      const variant: CommerceProductVariant = { ...(previousVariant ?? {}), id: previousVariant?.id ?? `${tenantId}:sku:${encodeURIComponent(skuKey(sku))}`, sku, color: color || null, pantsType, inventoryVerified: hasSizeStockMap && initialStockBySize !== undefined ? true : previousVariant?.inventoryVerified ?? false, status: active ? 'ACTIVE' : 'DRAFT', visibility: active ? 'VISIBLE' : 'HIDDEN', available: purchaseAvailability, stock, importedStock:stock, ...(initialStockBySize ? { initialStockBySize } : {}), minimumStock, salePriceCents: cents(sale), promotionalPriceCents: cents(promotion), fulfillmentMode, sizes, ...(sizes.length === 1 ? { size: sizes[0] } : {}), images: images.length ? images : previousVariant?.images ?? [] }
      const candidates = [...(working?.variants ?? base?.variants ?? [])].filter(item => item.id !== variant.id).concat(variant)
      const knownPrices = candidates.map(item => item.salePriceCents).filter((price): price is number => typeof price === 'number')
      const parentPrice = knownPrices.length ? Math.min(...knownPrices) : null
      const guide = parseFlatSizeGuide(row.guia_tallas)
      const product: CommerceProduct = {
        ...(working ?? base ?? {}), id: groupKey, tenantId, sku: productSku, slug: base?.slug ?? model, name, category: text(row.categoria), description: text(row.descripcion), commercialSummary: text(row.descripcion), currency,
        status: candidates.some(item => item.status === 'ACTIVE') ? 'ACTIVE' : 'DRAFT', visibility: candidates.some(item => item.visibility === 'VISIBLE') ? 'VISIBLE' : 'HIDDEN', fulfillmentMode, pricingStatus: parentPrice === null ? 'PENDING' : 'READY', salePriceCents: parentPrice, costCents: cents(cost), percentage: base?.percentage ?? null, percentageType: base?.percentageType ?? null, images: working?.images.length ? working.images : images.length ? images : base?.images ?? [], variants: candidates,
        collection: text(row.coleccion), gender: text(row.genero), characteristics: text(row.caracteristicas).split(/[;|\n]+/).map(value => value.trim()).filter(Boolean), material: text(row.material), ganoBotNotes: text(row.notas_ganobot), internalNotes: text(row.notas_internas), ...(guide ? { sizeGuide: guide } : {}), sizeRecommendation: text(row.recomendacion_talla), preparationTime: text(row.tiempo_preparacion), deliveryType: text(row.tipo_entrega), exchangePolicy: { allowed: boolean(row.permite_cambio), conditions: text(row.condiciones_cambio) },
      }
      // A previous product-level promotion must never silently apply to imported SKU prices.
      delete product.promotionalPriceCents
      validateCommerceProduct(product)
      if (available === null) issue(rowNumber, 'disponible', 'Disponibilidad no indicada; la variante queda sin disponibilidad confirmada', 'WARNING')
      if (requestedActive && !readyForPurchase) issue(rowNumber, 'precio_venta/stock_actual', 'La ficha queda visible, pero no admite compra directa hasta confirmar precio y disponibilidad', 'WARNING')
      if (!sizes.length) issue(rowNumber, 'talla', 'Sin tallas documentadas', 'WARNING')
      if (stock === null && fulfillmentMode === 'STOCK') issue(
        rowNumber,
        hasIndividualSizeColorStock ? 'stock_individual_por_talla_y_por_color' : 'stock_actual',
        hasIndividualSizeColorStock
          ? 'Stock por talla y color no configurado; la variante queda sin disponibilidad de compra'
          : 'Stock desconocido: no se puede reservar',
        'WARNING',
      )
      groups.set(groupKey, product)
      result.summary.validRows++
      if (previousVariant) result.summary.updates++; else result.summary.newVariants++
    } catch (cause) { issue(rowNumber, 'fila', cause instanceof Error ? cause.message : 'Fila inválida') }
  })
  result.products = [...groups.values()]
  result.summary.newProducts = result.products.filter(product => !existing.some(item => item.id === product.id)).length
  return result
}
