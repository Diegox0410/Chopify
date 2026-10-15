import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { prepareFloesBaseCombinations } from '../src/application/floesBaseCombinations.ts'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = process.argv[2]
if (!sourcePath) throw new Error('Usage: node --import tsx scripts/build-floes-base-combinations.mjs <master-workbook.xlsx> [output.json]')
const resolvedSource = path.resolve(sourcePath)
const outputPath = path.resolve(process.argv[3] ?? path.join(projectRoot, 'data', 'floes-base-combinations.json'))
const sourceBuffer = await readFile(resolvedSource)
const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(sourceBuffer)
const sheet = workbook.getWorksheet('468 combinaciones')
if (!sheet) throw new Error('Workbook is missing the "468 combinaciones" sheet')
const headers = sheet.getRow(1).values.slice(1).map(value => String(value ?? '').trim())
const rows = []
sheet.eachRow((row, index) => {
  if (index > 1) rows.push(Object.fromEntries(headers.map((header, column) => [header, row.getCell(column + 1).value])))
})
const combinations = prepareFloesBaseCombinations(rows)
const data = {
  schemaVersion: 1,
  tenantId: 'tenant-floes',
  environment: 'sandbox',
  source: { workbook: path.basename(resolvedSource), sheet: sheet.name, sha256: createHash('sha256').update(sourceBuffer).digest('hex'), rows: rows.length },
  counts: { models: 12, colors: 13, pantsTypes: 3, combinations: combinations.length },
  combinations,
}
await import('node:fs/promises').then(fs => fs.mkdir(path.dirname(outputPath), { recursive: true }))
await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
console.log(`FLOES_BASE_COMBINATIONS_GENERATED=${combinations.length}`)
console.log(`SOURCE_SHA256=${data.source.sha256}`)
console.log(`OUTPUT=${outputPath}`)
