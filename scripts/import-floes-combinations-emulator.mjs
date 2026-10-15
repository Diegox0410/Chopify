import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.resolve(process.argv[2] ?? path.join(projectRoot, 'data', 'floes-base-combinations.json'))
const host = process.env.FIRESTORE_EMULATOR_HOST
const projectId = process.env.FIREBASE_PROJECT_ID
if (!['127.0.0.1:8081', 'localhost:8081', '[::1]:8081'].includes(host) || projectId !== 'demo-floes-sandbox') {
  throw new Error('Refusing catalog import unless connected only to Firestore Emulator at loopback:8081 with demo-floes-sandbox')
}
const manifest = JSON.parse(await readFile(sourcePath, 'utf8'))
if (manifest.tenantId !== 'tenant-floes' || manifest.environment !== 'sandbox' || manifest.counts?.combinations !== 468 || manifest.combinations?.length !== 468 || !/^[a-f0-9]{64}$/.test(manifest.source?.sha256 ?? '')) {
  throw new Error('Catalog source manifest is incomplete, unexpected, or not the expected isolated 468-combination FLOES catalog')
}

const encode = value => {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } }
  throw new Error(`Unsupported Firestore value: ${typeof value}`)
}
const projectBase = `projects/${projectId}/databases/(default)/documents`
const encodeDocument = (id, fields) => ({ update: { name: `${projectBase}/floesBaseCombinationsSandbox/${id}`, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) } })
const documents = manifest.combinations.map(item => encodeDocument(item.id, { ...item, tenantId: 'tenant-floes', environment: 'sandbox', sourceWorkbook: manifest.source.workbook, sourceSheet: manifest.source.sheet, sourceSha256: manifest.source.sha256 }))
documents.push(encodeDocument('_manifest', { tenantId: 'tenant-floes', environment: 'sandbox', sourceWorkbook: manifest.source.workbook, sourceSheet: manifest.source.sheet, sourceSha256: manifest.source.sha256, combinationCount: manifest.counts.combinations, modelCount: manifest.counts.models, colorCount: manifest.counts.colors, pantsTypeCount: manifest.counts.pantsTypes, importedAt: new Date().toISOString() }))

let imported = 0
const endpoint = `http://${host}/v1/${projectBase}:commit`
for (let offset = 0; offset < documents.length; offset += 300) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ writes: documents.slice(offset, offset + 300) }) })
  if (!response.ok) throw new Error(`Firestore Emulator commit failed with HTTP ${response.status}`)
  imported += Math.min(300, documents.length - offset)
}
console.log(`FLOES_SANDBOX_COMBINATIONS_UPSERTED=${imported - 1}`)
console.log('FLOES_SANDBOX_MANIFEST_UPSERTED=1')
console.log(`SOURCE_SHA256=${manifest.source.sha256}`)
