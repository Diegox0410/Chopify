import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PublicCatalogStorage, publicCatalogImagePathFromAssetPath } from '../src/infrastructure/publicCatalogStorage.js'

const models = [
  { directory: 'MARIA_JOSE', model: 'María José' },
  { directory: 'DANIELA', model: 'Daniela' },
  { directory: 'ELITE', model: 'Élite' },
] as const
const expectedColorSlugs = new Set([
  'azul-marino', 'negro', 'palo-rosa', 'blanco', 'celeste', 'azul-electrico', 'gris',
  'verde-petroleo', 'verde-militar', 'lila', 'vino', 'verde-quirurgico', 'caqui',
])

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

const commerceRoot = resolve(required(process.argv[2] ?? process.env.FLOES_COMMERCE_REPO_DIR, 'FLOES_COMMERCE_REPO_DIR'))
const imageBaseUrl = required(process.env.FLOES_PUBLIC_BASE_URL, 'FLOES_PUBLIC_BASE_URL')
const publicDirectory = resolve(commerceRoot, 'public', 'catalogo', 'floes')
const storage = new PublicCatalogStorage({ env: { ...process.env, FLOES_PUBLIC_BASE_URL: imageBaseUrl }, publicDirectory })
const assets: Array<{ model: string; color: string; url: string; path: string; bytes: number }> = []

for (const entry of models) {
  const sourceDirectory = resolve(commerceRoot, entry.directory)
  if (!(await stat(sourceDirectory)).isDirectory()) throw new Error(`Missing source image directory: ${entry.directory}`)
  const files = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter(file => file.isFile() && /\.(jpe?g|png|webp)$/i.test(file.name))
    .map(file => file.name)
    .sort((left, right) => left.localeCompare(right))
  const colors = files.map(file => file.replace(/\.(jpe?g|png|webp)$/i, '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  if (files.length !== expectedColorSlugs.size || new Set(colors).size !== expectedColorSlugs.size || colors.some(color => !expectedColorSlugs.has(color))) {
    throw new Error(`${entry.directory} must contain each of the 13 expected FLOES color images exactly once`)
  }
  for (const filename of files) {
    const color = filename.replace(/\.(jpe?g|png|webp)$/i, '')
    const sourcePath = resolve(sourceDirectory, filename)
    const bytes = await readFile(sourcePath)
    const asset = await storage.upload({ tenantId: 'tenant-floes', model: entry.model, color, filename, dataBase64: bytes.toString('base64') })
    const path = publicCatalogImagePathFromAssetPath(`${entry.directory}/${filename}`)
    if (asset.objectPath !== path.slice(1) || !(await storage.exists({ tenantId: 'tenant-floes', model: entry.model, color }))) {
      throw new Error(`Public image verification failed for ${entry.directory}/${filename}`)
    }
    assets.push({ model: entry.model, color, url: asset.url, path, bytes: asset.bytes })
  }
}

const uniquePaths = new Set(assets.map(asset => asset.path))
if (assets.length !== 39 || uniquePaths.size !== 39) throw new Error(`Expected 39 unique FLOES images, found ${assets.length}`)
console.info(JSON.stringify({ expected: 39, synchronized: assets.length, uniqueUrls: new Set(assets.map(asset => asset.url)).size, baseUrl: imageBaseUrl, assets }, null, 2))
