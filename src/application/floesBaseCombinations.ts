export const FLOES_BASE_PANTS = [
  { code: 'P01', name: 'Jogger' },
  { code: 'P02', name: 'Basta recta' },
  { code: 'P03', name: 'Basta ancha' },
] as const

export const FLOES_APPLICABLE_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const

export interface FloesBaseCombination {
  id: string
  blouseCode: string
  model: string
  color: string
  pantsCode: string
  pantsType: string
  visualCriteria: string
  catalogStatus: string
  sizes: readonly string[]
  priceCents: null
  stockBySize: null
  inventoryVerified: false
  purchaseStatus: 'PENDING_OWNER_CATALOG_VALIDATION'
}

type Row = Record<string, unknown>
const text = (value: unknown) => value == null ? '' : String(value).trim()
const code = (value: unknown) => text(value).toUpperCase()
const slug = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** Converts the 468-row workbook sheet into deterministic potential combinations.
 * The sheet has no talla, price, or inventory facts; those fields deliberately remain pending.
 */
export function prepareFloesBaseCombinations(rows: readonly Row[], sizes: readonly string[] = FLOES_APPLICABLE_SIZES): FloesBaseCombination[] {
  if (!Array.isArray(rows) || rows.length !== 468) throw new Error(`Expected 468 potential combinations; received ${rows.length}`)
  const normalizedSizes = [...new Set(sizes.map(value => value.trim().toUpperCase()).filter(Boolean))]
  if (!normalizedSizes.length || normalizedSizes.length !== sizes.length) throw new Error('Applicable sizes must be non-empty and unique')
  const models = new Set<string>()
  const colors = new Set<string>()
  const pants = new Map<string, string>(FLOES_BASE_PANTS.map(item => [item.code, item.name]))
  const seen = new Set<string>()
  const combinations = rows.map((row, index): FloesBaseCombination => {
    const blouseCode = code(row['Código blusa'])
    const model = text(row.Modelo)
    const color = text(row.Color)
    const pantsCode = code(row['Código pantalón'])
    const pantsType = text(row['Tipo pantalón'])
    const visualCriteria = text(row['Criterio visual'])
    const catalogStatus = text(row['Estado catálogo'])
    if (!/^B\d{2}$/.test(blouseCode) || !model || !color || !pants.has(pantsCode) || pants.get(pantsCode) !== pantsType || !visualCriteria || !catalogStatus) {
      throw new Error(`Invalid combination source row ${index + 2}`)
    }
    const id = `${blouseCode}-${slug(color)}-${pantsCode}`
    if (seen.has(id)) throw new Error(`Duplicate base combination: ${id}`)
    seen.add(id)
    models.add(model)
    colors.add(color)
    return { id, blouseCode, model, color, pantsCode, pantsType, visualCriteria, catalogStatus, sizes: normalizedSizes, priceCents: null, stockBySize: null, inventoryVerified: false, purchaseStatus: 'PENDING_OWNER_CATALOG_VALIDATION' }
  })
  if (models.size !== 12 || colors.size !== 13 || pants.size !== 3) throw new Error(`Unexpected base catalog dimensions: ${models.size} models × ${colors.size} colors × ${pants.size} pants`)
  for (const model of models) {
    const modelRows = combinations.filter(item => item.model === model)
    if (modelRows.length !== 39 || new Set(modelRows.map(item => item.color)).size !== 13 || new Set(modelRows.map(item => item.pantsCode)).size !== 3) {
      throw new Error(`Incomplete base combinations for model ${model}`)
    }
  }
  return combinations
}
