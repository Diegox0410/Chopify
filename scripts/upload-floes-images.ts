import { loadEnvFile } from 'node:process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogImageSlug, preflightCatalogStorage, uploadCatalogImage, type CatalogImageAsset } from '../src/infrastructure/catalogImageStorage.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
try { loadEnvFile(resolve(root, '.env.local')) }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to load local server environment', { cause: error }) }

const models = [
  { directory: 'MARIA_JOSE', model: 'Modelo María José' },
  { directory: 'DANIELA', model: 'Modelo Daniela' },
  { directory: 'ELITE', model: 'Modelo Elite' },
] as const
const destination = resolve(root, '.catalog-import', 'asset-manifest.json')

async function main() {
  await preflightCatalogStorage()
  let previous: { assets?: Array<CatalogImageAsset & { model: string; color: string; sourcePath: string }> } = {}
  try { previous = JSON.parse(await readFile(destination, 'utf8')) as typeof previous }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Existing catalog asset manifest is invalid', { cause: error }) }
  const manifest = { version: 1, tenantId: 'tenant-floes', generatedAt: new Date().toISOString(), assets: previous.assets ?? [] }
  await mkdir(resolve(root, '.catalog-import'), { recursive: true })
  for (const { directory, model } of models) {
    const folder = resolve(root, directory)
    const files = (await readdir(folder, { withFileTypes: true })).filter(entry => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))
    for (const file of files) {
      const sourcePath = resolve(folder, file.name)
      const color = file.name.replace(/\.[^.]+$/, '').replaceAll('_', ' ')
      const dataBase64 = (await readFile(sourcePath)).toString('base64')
      const asset = await uploadCatalogImage({ tenantId: 'tenant-floes', model, color, filename: file.name, dataBase64 })
      manifest.assets = manifest.assets.filter(existing => !(catalogImageSlug(existing.model) === catalogImageSlug(model) && existing.sourceFilename === file.name))
      manifest.assets.push({ ...asset, model, color, sourcePath })
      await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      console.info(JSON.stringify({ stage: 'catalog_image_verified', model, color, filename: file.name, width: asset.width, height: asset.height, bytes: asset.bytes }))
    }
  }
  console.info(JSON.stringify({ stage: 'catalog_asset_manifest_complete', count: manifest.assets.length, path: destination }))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Catalog image upload failed')
  process.exitCode = 1
})
