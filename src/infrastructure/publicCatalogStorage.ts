/// <reference types="node" />
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import {
  CatalogImageError,
  catalogImageSlug,
  validateCatalogImageInput,
  validateCatalogImageReference,
  type CatalogImageAsset,
  type CatalogImageInput,
  type CatalogImageReference,
  type CatalogImageStorage,
} from './catalogImageStorage.js'
import type { ServerEnvironment, ServerFetch } from './serviceAccountOAuth.js'

const PUBLIC_PREFIX = 'catalogo/floes'

export interface PublicCatalogStorageOptions {
  env?: ServerEnvironment
  publicDirectory?: string
  fetch?: ServerFetch
}

function modelSlug(value: string) {
  return catalogImageSlug(value.replace(/^modelo[-\s]+/i, ''))
}

export function publicCatalogImagePath(model: string, color: string) {
  const normalized = validateCatalogImageReference({ tenantId: 'tenant-floes', model, color })
  return `${PUBLIC_PREFIX}/${modelSlug(normalized.model)}/${catalogImageSlug(normalized.color)}.jpeg`
}

/** Resolve a workbook/local asset path such as `DANIELA/VINO.jpeg` to its public URL path. */
export function publicCatalogImagePathFromAssetPath(assetPath: string) {
  const parts = assetPath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 2) throw new CatalogImageError('Catalog image path must include a model folder and filename')
  const filename = parts.at(-1) ?? ''
  if (!/^[\p{L}\p{N}_ -]+\.(jpe?g|png|webp)$/iu.test(filename)) throw new CatalogImageError('Unsupported catalog image filename')
  return `/${publicCatalogImagePath(parts.at(-2) ?? '', filename.replace(/\.(jpe?g|png|webp)$/i, ''))}`
}

function checkedBaseUrl(env: ServerEnvironment) {
  const value = env.FLOES_PUBLIC_BASE_URL?.trim()
  if (!value) throw new CatalogImageError('FLOES_PUBLIC_BASE_URL is not configured', 503)
  let url: URL
  try { url = new URL(value) }
  catch { throw new CatalogImageError('FLOES_PUBLIC_BASE_URL is invalid', 503) }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new CatalogImageError('FLOES_PUBLIC_BASE_URL must be an HTTPS origin (HTTP is allowed only for localhost)', 503)
  }
  return url.origin
}

async function optimizeJpeg(input: CatalogImageInput) {
  const bytes = Buffer.from(input.dataBase64, 'base64')
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: 'warning' })
    const metadata = await image.metadata()
    const extension = input.filename.split('.').at(-1)?.toLowerCase()
    const expected = extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || metadata.format !== expected || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) {
      throw new Error('Unsupported image')
    }
    let output = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    if (output.data.length > 1_500_000) output = await sharp(output.data).jpeg({ quality: 76, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    if (output.data.length > 3 * 1024 * 1024) throw new Error('Optimized image is too large')
    return output
  } catch {
    throw new CatalogImageError('Invalid image; use a single JPEG, PNG or WebP image up to 3 MiB')
  }
}

/**
 * Static Vercel provider. `upload` is used by the local asset-sync command;
 * deployed API calls only resolve and HEAD-check files already in public/.
 */
export class PublicCatalogStorage implements CatalogImageStorage {
  readonly provider = 'public' as const
  private readonly env: ServerEnvironment
  private readonly publicDirectory?: string
  private readonly request: ServerFetch

  constructor(options: PublicCatalogStorageOptions = {}) {
    this.env = options.env ?? process.env
    this.publicDirectory = options.publicDirectory ?? (this.env.FLOES_PUBLIC_CATALOG_DIRECTORY?.trim() || undefined)
    this.request = options.fetch ?? fetch
  }

  async getPublicUrl(reference: CatalogImageReference) {
    const normalized = validateCatalogImageReference(reference)
    const relative = publicCatalogImagePath(normalized.model, normalized.color)
    return `${checkedBaseUrl(this.env)}/${relative.split('/').map(encodeURIComponent).join('/')}`
  }

  async exists(reference: CatalogImageReference) {
    const normalized = validateCatalogImageReference(reference)
    if (this.publicDirectory) {
      const target = path.join(this.publicDirectory, modelSlug(normalized.model), `${catalogImageSlug(normalized.color)}.jpeg`)
      try { return (await stat(target)).isFile() }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
    }
    const response = await this.request(await this.getPublicUrl(normalized), { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(12_000) })
    if (response.status === 404) return false
    if (!response.ok) throw new CatalogImageError(`Public catalog image check failed (${response.status})`, 503)
    return response.headers.get('content-type')?.toLowerCase().startsWith('image/jpeg') ?? false
  }

  async upload(raw: CatalogImageInput): Promise<CatalogImageAsset> {
    const input = validateCatalogImageInput(raw)
    if (!this.publicDirectory) throw new CatalogImageError('Static catalog uploads require the local FLOES_PUBLIC_CATALOG_DIRECTORY', 503)
    const optimized = await optimizeJpeg(input)
    const relativePath = publicCatalogImagePath(input.model, input.color)
    const target = path.join(this.publicDirectory, modelSlug(input.model), `${catalogImageSlug(input.color)}.jpeg`)
    await mkdir(path.dirname(target), { recursive: true })
    let existingHash: string | undefined
    try { existingHash = createHash('sha256').update(await readFile(target)).digest('hex') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const sha256 = createHash('sha256').update(optimized.data).digest('hex')
    if (existingHash !== sha256) {
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporary, optimized.data, { flag: 'wx' })
      await rename(temporary, target)
    }
    return {
      url: await this.getPublicUrl({ tenantId: input.tenantId, model: input.model, color: input.color }),
      alt: `${input.model} — ${input.color}`,
      width: optimized.info.width,
      height: optimized.info.height,
      bytes: optimized.data.length,
      mimeType: 'image/jpeg',
      sha256,
      objectPath: relativePath,
      sourceFilename: input.filename,
    }
  }
}
