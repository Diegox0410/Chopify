import type { FlatSizeGuide, FlatSizeRow } from '../../domain/commerce.js'

// Global FLOES guide supplied by the Owner. These are horizontal measurements
// of a flat garment in centimetres, independent of model/color inventory rows.
const rows = (columns: readonly string[], values: readonly (readonly [string, ...number[]])[]): readonly FlatSizeRow[] =>
  Object.freeze(values.map(([size, ...measurements]) => Object.freeze({
    size, measurementsCm: Object.freeze(Object.fromEntries(columns.map((column, index) => [column, measurements[index]]))),
  })))

export const floesSizeGuide: Readonly<FlatSizeGuide> = Object.freeze({
  measurement: 'FLAT_GARMENT_CM',
  instructions: 'Extiende una prenda que te quede bien sobre una superficie plana y mídela horizontalmente en centímetros. Compara las medidas de esa prenda con las tablas de blusa y pantalón. Son medidas de la prenda plana, no medidas corporales ni contornos; no las multipliques por dos. Si estás entre tallas, considera tu preferencia de ajuste y solicita orientación. La guía no garantiza un ajuste perfecto.',
  blouse: rows(['pecho', 'cintura', 'cadera', 'largo', 'manga'], [
    ['XS', 45, 40, 46, 59, 17],
    ['S', 48, 42, 48, 59, 18],
    ['M', 50, 45, 52, 60, 21],
    ['L', 53, 48, 56, 62, 22],
    ['XL', 57, 54, 62, 70, 23],
  ]),
  trousers: rows(['cintura', 'cadera', 'muslo', 'largo', 'basta'], [
    ['XS', 45, 48, 29, 95, 19],
    ['S', 47, 50, 30, 97, 19],
    ['M', 50, 54, 32, 100, 20],
    ['L', 53, 57, 34, 104, 20],
    ['XL', 57, 61, 36, 105, 21],
  ]),
})
