import type { CatalogRow } from './catalogImport.js'
import { normalizeCatalogKey } from './catalogImport.js'

/** RFC4180 CSV including BOM, quoted delimiters/newlines and Excel semicolon exports. */
export function parseCatalogCsv(input: string): CatalogRow[] {
  const source = input.replace(/^\uFEFF/, '')
  const firstLine = source.split(/\r?\n/, 1)[0]
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
  const matrix: string[][] = []; let row: string[] = [], value = '', quoted = false
  for (let i = 0; i < source.length; i++) {
    const character = source[i]
    if (character === '"') { if (quoted && source[i + 1] === '"') { value += '"'; i++ } else quoted = !quoted }
    else if (!quoted && character === delimiter) { row.push(value); value = '' }
    else if (!quoted && (character === '\n' || character === '\r')) { if (character === '\r' && source[i + 1] === '\n') i++; row.push(value); matrix.push(row); row = []; value = '' }
    else value += character
  }
  if (quoted) throw new Error('CSV contiene comillas sin cerrar')
  if (value || row.length) { row.push(value); matrix.push(row) }
  const [headers, ...data] = matrix
  if (!headers) throw new Error('CSV vacío')
  return data.filter(values => values.some(cell => cell.trim())).map((values, index) => ({ ...Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ''])), __row: index + 2 }))
}
export async function readCatalogFile(name: string, bytes: ArrayBuffer): Promise<CatalogRow[]> {
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('El Excel/CSV supera 20 MB')
  if (/\.csv$/i.test(name)) return parseCatalogCsv(new TextDecoder().decode(bytes))
  if (!/\.xlsx$/i.test(name)) throw new Error('Selecciona un archivo XLSX o CSV')
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.default.Workbook()
  await workbook.xlsx.load(bytes)
  for (const sheet of workbook.worksheets) {
    let headers: string[] | undefined; let headerIndex = 0
    sheet.eachRow((row, index) => {
      if (headers || index > 30) return
      const values = (row.values as unknown[]).slice(1).map(value => String(value ?? ''))
      if (values.some(value => normalizeCatalogKey(value) === 'nombre-producto') && values.some(value => normalizeCatalogKey(value) === 'sku')) { headers = values; headerIndex = index }
    })
    if (!headers) continue
    const rows: CatalogRow[] = []
    sheet.eachRow((row, index) => {
      if (index <= headerIndex) return
      const record: CatalogRow = { __row: index }
      headers!.forEach((header, column) => { const cell = row.getCell(column + 1); const value = cell.value; record[header] = value && typeof value === 'object' && 'formula' in value ? value.result ?? '' : cell.text })
      if (Object.entries(record).some(([key, value]) => key !== '__row' && String(value).trim())) rows.push(record)
    })
    return rows
  }
  throw new Error('No se encontró una hoja con columnas nombre_producto y sku')
}
