import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { parseCatalogCsv, readCatalogFile } from './catalogFiles.js'
import { previewCatalogImport, type CatalogRow } from './catalogImport.js'
import { createSampleOrderDatabase, SampleBusinessCommerceAdapter } from '../adapters/memory/orderRepositories.js'
import { commerceCatalogView } from './commerceCatalogView.js'

const row = (sku = 'FLOES-DAN-VINO-M', extra: Record<string, unknown> = {}): CatalogRow => ({
  nombre_producto: 'Modelo Daniela', sku, color: 'Vino', talla: 'M', moneda: 'USD', activo: 'SI', disponible: 'SI',
  tipo_entrega: 'Servientrega', stock_actual: 10, stock_minimo: 2, precio_venta: 40, precio_promocional: 37,
  ...extra,
})
const perSizeRow = (sku = 'FLOES-DAN-01', extra: Record<string, unknown> = {}): CatalogRow => row(sku, {
  stock_actual: '', talla: 'Xs-S-M-L-XL', stock_individual_por_talla_y_por_color: 10,
  imagen_1: 'https://images.example.test/daniela-vino.webp', ...extra,
})

describe('FLOES catalog import', () => {
  it('parses CSV headers, quoted commas, and one-based source row numbers', () => {
    expect(parseCatalogCsv('nombre_producto,sku,color\n"Modelo María José",MJ-1,"Vino, oscuro"')).toEqual([
      { nombre_producto: 'Modelo María José', sku: 'MJ-1', color: 'Vino, oscuro', __row: 2 },
    ])
  })

  it('parses the final XLSX header row and preserves its stock field name', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Productos')
    sheet.addRow(['Plantilla FLOES'])
    sheet.addRow(['Instrucciones'])
    sheet.addRow(['OBLIGATORIO', 'OBLIGATORIO'])
    sheet.addRow(['nombre_producto', 'sku', 'categoria', 'coleccion', 'genero', 'descripcion', 'caracteristicas', 'material', 'color', 'Tela 1', 'talla', 'stock_individual_por_talla_y_por_color', 'stock_minimo', 'costo_unitario', 'precio_venta', 'precio_promocional', 'moneda', 'disponible', 'imagen_1', 'guia_tallas', 'recomendacion_talla', 'tipo_entrega', 'tiempo_preparacion', 'permite_cambio', 'condiciones_cambio', 'notas_ganobot', 'notas_internas', 'activo'])
    sheet.addRow(['Modelo Daniela', 'FLOES-DAN-01', 'Scrub Mujer', 'Esencial', 'Mujer', '', '', 'Antifluido', 'Azul marino', 'Novak', 'Xs-S-M-L-XL', 10, 2, 22, 46.99, 41.99, 'USD', 'SI', 'C:\\assets\\DANIELA\\AZUL_MARINO.jpeg', '', '', 'Servientrega', '', '', '', '', '', 'SI'])
    const source = new Uint8Array(await workbook.xlsx.writeBuffer())
    const bytes = new ArrayBuffer(source.byteLength)
    new Uint8Array(bytes).set(source)
    const parsed = await readCatalogFile('catalogo.xlsx', bytes)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ __row: 5, nombre_producto: 'Modelo Daniela', sku: 'FLOES-DAN-01', color: 'Azul marino', talla: 'Xs-S-M-L-XL', stock_individual_por_talla_y_por_color: '10' })
  })

  it('groups color variants by model and resolves canonical Verde Petróleo image paths', () => {
    const preview = previewCatalogImport('tenant-floes', [
      row('D-1', { color: 'Verde Petróleo', imagen_1: 'C:\\legacy\\DANIELA\\VERDE_PETROLEO.jpeg' }),
      row('D-2', { color: 'Vino', imagen_1: 'DANIELA/VINO.jpeg' }),
    ], [], { 'DANIELA/VERDE_PETROLEO.jpeg': 'https://images.example.test/verde.webp', 'DANIELA/VINO.jpeg': 'https://images.example.test/vino.webp' })
    expect(preview.products).toHaveLength(1)
    expect(preview.products[0].variants.map(variant => variant.color)).toEqual(['Verde Petróleo', 'Vino'])
    expect(preview.issues).toHaveLength(0)
    expect(preview.summary.imagesFound).toBe(2)
    expect(preview.products[0].variants[0].images[0].url).toBe('https://images.example.test/verde.webp')
    expect(preview.products[0].variants[1].images[0].url).toBe('https://images.example.test/vino.webp')
  })

  it('preserves the source color label without a pilot-only allowlist', () => {
    const preview = previewCatalogImport('tenant-floes', [row('D-EL', { color: 'Azul Electrico', imagen_1: 'https://images.example.test/azul-electrico.webp' })])
    expect(preview.products[0].variants[0].color).toBe('Azul Electrico')
    expect(preview.issues).toHaveLength(0)
  })

  it('expands one source row into independent normalized size positions with configured stock per size', async () => {
    const db = createSampleOrderDatabase(), adapter = new SampleBusinessCommerceAdapter(db)
    const preview = previewCatalogImport('tenant-floes', [perSizeRow('FLOES-MABE-01', { nombre_producto: 'Modelo Mabe' })])
    const variant = preview.products[0].variants[0]
    expect(variant.sizes).toEqual(['XS', 'S', 'M', 'L', 'XL'])
    expect(variant.initialStockBySize).toEqual({ XS: 10, S: 10, M: 10, L: 10, XL: 10 })
    expect(variant).toMatchObject({ stock: 50, importedStock: 50, available: true })
    await adapter.upsertProducts('tenant-floes', preview.products)
    const positions = db.inventory.filter(position => position.tenantId === 'tenant-floes' && position.productId === preview.products[0].id && position.variantId === variant.id)
    expect(positions).toHaveLength(5)
    expect(positions.map(position => position.size).sort()).toEqual(['L', 'M', 'S', 'XL', 'XS'])
    expect(positions.every(position => position.onHand === 10 && position.reserved === 0)).toBe(true)
  })

  it('reserves and commits one size without changing the other size positions', async () => {
    const db = createSampleOrderDatabase(), adapter = new SampleBusinessCommerceAdapter(db)
    const preview = previewCatalogImport('tenant-floes', [perSizeRow()])
    const product = preview.products[0], variant = product.variants[0]
    await adapter.upsertProducts('tenant-floes', preview.products)
    const reservation = [{ productId: product.id, variantId: variant.id, size: 'm', quantity: 1 }]
    await adapter.reserveInventory('tenant-floes', reservation)
    expect(await adapter.getAvailability('tenant-floes', product.id, variant.id, 'M')).toBe(9)
    expect(await adapter.getAvailability('tenant-floes', product.id, variant.id, 'S')).toBe(10)
    await adapter.commitInventory('tenant-floes', reservation)
    expect(await adapter.getPosition('tenant-floes', product.id, variant.id, 'M')).toMatchObject({ size: 'M', onHand: 9, reserved: 0 })
    expect(await adapter.getPosition('tenant-floes', product.id, variant.id, 'S')).toMatchObject({ size: 'S', onHand: 10, reserved: 0 })
  })

  it('reports out-of-stock for only the exhausted size', async () => {
    const db = createSampleOrderDatabase(), adapter = new SampleBusinessCommerceAdapter(db)
    const preview = previewCatalogImport('tenant-floes', [perSizeRow()])
    const product = preview.products[0], variant = product.variants[0]
    await adapter.upsertProducts('tenant-floes', preview.products)
    const exhausted = [{ productId: product.id, variantId: variant.id, size: 'XS', quantity: 10 }]
    await adapter.reserveInventory('tenant-floes', exhausted)
    await adapter.commitInventory('tenant-floes', exhausted)
    const view = await commerceCatalogView((await adapter.listProducts('tenant-floes')).find(item => item.id === product.id)!, adapter)
    const sizeAvailability = (view.variants[0] as { sizeAvailability: Array<{ size: string; available: boolean; availableQuantity: number | null; availabilityStatus: string }> }).sizeAvailability
    expect(sizeAvailability.find(item => item.size === 'XS')).toMatchObject({ available: false, availableQuantity: 0, availabilityStatus: 'OUT_OF_STOCK' })
    expect(sizeAvailability.find(item => item.size === 'M')).toMatchObject({ available: true, availableQuantity: 10, availabilityStatus: 'AVAILABLE' })
    expect((view.variants[0] as { available: boolean }).available).toBe(true)
  })

  it('preserves sold and reserved size balances on reimport and rejects a changed initial stock after activity', async () => {
    const db = createSampleOrderDatabase(), adapter = new SampleBusinessCommerceAdapter(db)
    const original = perSizeRow()
    const first = previewCatalogImport('tenant-floes', [original])
    const product = first.products[0], variant = product.variants[0]
    await adapter.upsertProducts('tenant-floes', first.products)
    const sold = [{ productId: product.id, variantId: variant.id, size: 'M', quantity: 1 }]
    await adapter.reserveInventory('tenant-floes', sold)
    await adapter.commitInventory('tenant-floes', sold)
    const activeReservation = [{ productId: product.id, variantId: variant.id, size: 'M', quantity: 2 }]
    await adapter.reserveInventory('tenant-floes', activeReservation)
    const reimport = previewCatalogImport('tenant-floes', [original], await adapter.listProducts('tenant-floes'))
    await adapter.upsertProducts('tenant-floes', reimport.products)
    expect(await adapter.getPosition('tenant-floes', product.id, variant.id, 'M')).toMatchObject({ onHand: 9, reserved: 2 })
    expect(await adapter.getAvailability('tenant-floes', product.id, variant.id, 'M')).toBe(7)
    expect(await adapter.getAvailability('tenant-floes', product.id, variant.id, 'S')).toBe(10)
    const changed = previewCatalogImport('tenant-floes', [perSizeRow('FLOES-DAN-01', { stock_individual_por_talla_y_por_color: 12 })], await adapter.listProducts('tenant-floes'))
    await expect(adapter.upsertProducts('tenant-floes', changed.products)).rejects.toThrow('Configured stock changed after inventory activity')
  })

  it('imports the expected pilot total of 195 positions and 1,950 initial units', async () => {
    const db = createSampleOrderDatabase(), adapter = new SampleBusinessCommerceAdapter(db)
    const colors = ['Azul marino', 'Negro', 'Palo Rosa', 'Blanco', 'Celeste', 'Azul Electrico', 'Gris', 'Verde Petroleo', 'Verde militar', 'Lila', 'Vino', 'Verde Quirurgico', 'Caqui']
    const models = [
      { name: 'Modelo María José', prefix: 'FLOES-MJ-', pad: 3 },
      { name: 'Modelo Daniela', prefix: 'FLOES-DAN-', pad: 2 },
      { name: 'Modelo Elite', prefix: 'FLOES-ELI-', pad: 2 },
    ]
    const rows = models.flatMap(model => colors.map((color, index) => perSizeRow(`${model.prefix}${String(index + 1).padStart(model.pad, '0')}`, {
      nombre_producto: model.name, color, imagen_1: `https://images.example.test/${model.prefix}${index + 1}.webp`,
    })))
    const preview = previewCatalogImport('tenant-floes', rows)
    expect(preview.summary).toMatchObject({ rows: 39, validRows: 39, newProducts: 3, newVariants: 39, duplicateSkus: 0 })
    await adapter.upsertProducts('tenant-floes', preview.products)
    const pilotPositions = db.inventory.filter(position => position.tenantId === 'tenant-floes' && preview.products.some(product => product.id === position.productId))
    expect(pilotPositions).toHaveLength(195)
    expect(pilotPositions.reduce((total, position) => total + position.onHand, 0)).toBe(1_950)
    expect(preview.products.map(product => product.variants.length)).toEqual([13, 13, 13])
  })

  it('rejects tenant mismatch, duplicate tenant SKUs, and unsafe image URLs', () => {
    expect(() => previewCatalogImport('tenant-mg', [row()])).toThrow('tenant-floes')
    const duplicate = previewCatalogImport('tenant-floes', [row(), row()])
    expect(duplicate.summary.duplicateSkus).toBe(1)
    expect(duplicate.issues.some(issue => issue.field === 'sku' && issue.severity === 'ERROR')).toBe(true)
    const unsafe = previewCatalogImport('tenant-floes', [row('D-3', { imagen_1: 'http://images.example.test/vino.jpg' })])
    expect(unsafe.issues.some(issue => issue.severity === 'ERROR' && /URL.*HTTPS/.test(issue.message))).toBe(true)
  })

  it('reimport is idempotent and preserves active inventory reservations', async () => {
    const db = createSampleOrderDatabase()
    const adapter = new SampleBusinessCommerceAdapter(db)
    const first = previewCatalogImport('tenant-floes', [row()])
    await adapter.upsertProducts('tenant-floes', first.products)
    const product = first.products[0]
    const position = db.inventory.find(item => item.tenantId === 'tenant-floes' && item.productId === product.id && item.variantId === product.variants[0].id)
    expect(position).toBeDefined()
    position!.reserved = 3
    const before = await adapter.getAvailability('tenant-floes', product.id, product.variants[0].id)
    const second = previewCatalogImport('tenant-floes', [row()], await adapter.listProducts('tenant-floes'))
    await adapter.upsertProducts('tenant-floes', second.products)
    const third = previewCatalogImport('tenant-floes', [row()], await adapter.listProducts('tenant-floes'))
    await adapter.upsertProducts('tenant-floes', third.products)
    expect(second.summary.updates).toBe(1)
    expect((await adapter.listProducts('tenant-floes')).filter(item => item.id === product.id)).toHaveLength(1)
    expect(await adapter.getAvailability('tenant-floes', product.id, product.variants[0].id)).toBe(before)
    expect(before).toBe(7)
  })
})
