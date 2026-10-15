import { describe, expect, it } from 'vitest'
import { FLOES_APPLICABLE_SIZES, prepareFloesBaseCombinations } from './floesBaseCombinations.js'

const models = ['Daniela', 'María José', 'Élite', 'Laly', 'Esencial', 'Esperanza', 'Mabe', 'Klit', 'Bruni', 'Girasol', 'Florma', 'Maemi']
const colors = ['Vino', 'Azul eléctrico', 'Verde militar', 'Lila', 'Verde petróleo', 'Gris', 'Blanco', 'Verde quirúrgico', 'Caqui', 'Celeste', 'Palo rosa', 'Negro', 'Azul marino']
const pants = [['P01', 'Jogger'], ['P02', 'Basta recta'], ['P03', 'Basta ancha']] as const
const rows = models.flatMap((model, index) => colors.flatMap((color, colorIndex) => pants.map(([pantsCode, pantsType]) => ({
  'Código blusa': `B${String(index + 1).padStart(2, '0')}`, Modelo: model, Color: color,
  'Código pantalón': pantsCode, 'Tipo pantalón': pantsType, 'Criterio visual': 'Mismo color', 'Estado catálogo': 'Potencial',
  colorIndex,
}))))

describe('FLOES base combinations', () => {
  it('produces all 468 deterministic model/color/pants combinations without inventing stock or prices', () => {
    const result = prepareFloesBaseCombinations(rows)
    expect(result).toHaveLength(468)
    expect(new Set(result.map(item => item.id)).size).toBe(468)
    expect(result[0]).toMatchObject({ model: 'Daniela', color: 'Vino', pantsType: 'Jogger', sizes: FLOES_APPLICABLE_SIZES, priceCents: null, stockBySize: null, inventoryVerified: false, purchaseStatus: 'PENDING_OWNER_CATALOG_VALIDATION' })
    expect(result.filter(item => item.model === 'Maemi')).toHaveLength(39)
  })

  it('rejects duplicates and mismatched pants codes', () => {
    expect(() => prepareFloesBaseCombinations(rows.slice(1))).toThrow(/Expected 468/)
    const invalid = structuredClone(rows)
    invalid[0]['Tipo pantalón'] = 'Basta ancha'
    expect(() => prepareFloesBaseCombinations(invalid)).toThrow(/Invalid combination source row/)
  })
})
