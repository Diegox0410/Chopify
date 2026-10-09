/// <reference types="node" />
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { serviceAccountAccessToken, serviceAccountCredentials, type ServerEnvironment, type ServerFetch } from './serviceAccountOAuth.js'

export const MAX_CATALOG_IMAGE_BYTES = 3 * 1024 * 1024
const hasControlCharacters = (value: string) => [...value].some(character => {
  const code = character.charCodeAt(0)
  return code < 32 || code === 127
})
const MAX_BASE64_LENGTH = Math.ceil(MAX_CATALOG_IMAGE_BYTES / 3) * 4
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
const CACHE_CONTROL = 'public, max-age=31536000, immutable'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export class CatalogImageError extends Error {
  readonly status: number
  constructor(message: string, status = 400) { super(message); this.name = 'CatalogImageError'; this.status = status }
}

export interface CatalogImageInput {
  tenantId: string
  model: string
  color: string
  filename: string
  dataBase64: string
}

export interface CatalogImageAsset {
  url: string
  alt: string
  width: number
  height: number
  bytes: number
  mimeType: 'image/webp'
  sha256: string
  objectPath: string
  sourceFilename: string
}

export interface CatalogStorageOptions { env?: ServerEnvironment; fetch?: ServerFetch }

export function catalogImageSlug(label: string): string {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function label(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 100 || hasControlCharacters(value) || /[/\\]/.test(value)) {
    throw new CatalogImageError(`Invalid ${name}`)
  }
  const result = value.trim()
  if (!catalogImageSlug(result)) throw new CatalogImageError(`Invalid ${name}`)
  return result
}

export function validateCatalogImageInput(raw: unknown): CatalogImageInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CatalogImageError('Invalid image upload body')
  const value = raw as Record<string, unknown>
  if (value.tenantId !== 'tenant-floes') throw new CatalogImageError('Tenant not allowed', 403)
  const model = label(value.model, 'model')
  const color = label(value.color, 'color')
  if (typeof value.filename !== 'string' || value.filename.length > 180 ||
      !/^[\p{L}\p{N}_ -]+\.(jpe?g|png|webp)$/iu.test(value.filename)) {
    throw new CatalogImageError('Unsupported image filename; use JPEG, PNG or WebP')
  }
  if (typeof value.dataBase64 !== 'string' || value.dataBase64.length === 0 || value.dataBase64.length > MAX_BASE64_LENGTH ||
      value.dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.dataBase64)) {
    throw new CatalogImageError('Invalid base64 image or image exceeds 3 MiB')
  }
  const decoded = Buffer.from(value.dataBase64, 'base64')
  if (decoded.length === 0 || decoded.length > MAX_CATALOG_IMAGE_BYTES || decoded.toString('base64') !== value.dataBase64) {
    throw new CatalogImageError('Invalid base64 image or image exceeds 3 MiB')
  }
  return { tenantId: 'tenant-floes', model, color, filename: value.filename, dataBase64: value.dataBase64 }
}

function configuration(env: ServerEnvironment) {
  const configured = env.CHOPIFY_CATALOG_STORAGE_BUCKET?.trim() || env.VITE_FIREBASE_STORAGE_BUCKET?.trim()
  if (!configured) throw new CatalogImageError('Catalog storage bucket is not configured', 503)
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(configured) || configured.includes('..')) {
    throw new CatalogImageError('Invalid catalog storage bucket configuration', 503)
  }
  let projectId: string
  try { projectId = serviceAccountCredentials(env).project_id }
  catch { throw new CatalogImageError('Catalog storage service account is not configured correctly', 503) }
  const firebaseProject = configured.match(/^(.+)\.(?:appspot\.com|firebasestorage\.app)$/)?.[1]
  if (firebaseProject && firebaseProject !== projectId) throw new CatalogImageError('Catalog bucket and service account projects do not match', 503)
  return { bucket: configured, projectId }
}

export async function preflightCatalogStorage(options: CatalogStorageOptions = {}) {
  const env = options.env ?? process.env
  const request = options.fetch ?? fetch
  const config = configuration(env)
  const token = await serviceAccountAccessToken(env, STORAGE_SCOPE, request)
  const response = await request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config.bucket)}?fields=name,projectNumber`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new CatalogImageError(`Catalog storage bucket is unavailable (${response.status})`, 503)
  const bucket = await response.json() as { name?: string; projectNumber?: string }
  if (bucket.name !== config.bucket) throw new CatalogImageError('Catalog storage returned an unexpected bucket', 503)
  return { ...config, projectNumber: bucket.projectNumber ?? null }
}

async function optimize(input: CatalogImageInput) {
  const bytes = Buffer.from(input.dataBase64, 'base64')
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: 'warning' })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) {
      throw new Error('Unsupported image')
    }
    const extension = input.filename.split('.').at(-1)?.toLowerCase()
    const expected = extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension
    if (metadata.format !== expected) throw new Error('Image format does not match filename')
    const output = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true })
    if (output.data.length > 1024 * 1024) {
      const smaller = await sharp(output.data).webp({ quality: 68, effort: 5 }).toBuffer({ resolveWithObject: true })
      if (smaller.data.length > MAX_CATALOG_IMAGE_BYTES) throw new Error('Optimized image is too large')
      return smaller
    }
    return output
  } catch { throw new CatalogImageError('Invalid image; upload a single JPEG, PNG or WebP image up to 3 MiB') }
}

export async function uploadCatalogImage(raw: unknown, options: CatalogStorageOptions = {}): Promise<CatalogImageAsset> {
  const input = validateCatalogImageInput(raw)
  const optimized = await optimize(input)
  const env = options.env ?? process.env
  const request = options.fetch ?? fetch
  const config = await preflightCatalogStorage(options)
  const token = await serviceAccountAccessToken(env, STORAGE_SCOPE, request)
  const sha256 = createHash('sha256').update(optimized.data).digest('hex')
  const objectPath = `floes/catalog/${catalogImageSlug(input.model)}/${catalogImageSlug(input.color)}-${sha256}.webp`
  const downloadToken = randomUUID()
  const boundary = `catalog-${randomUUID()}`
  const metadata = {
    name: objectPath, contentType: 'image/webp', cacheControl: CACHE_CONTROL,
    metadata: { firebaseStorageDownloadTokens: downloadToken, sha256, tenantId: 'tenant-floes' },
  }
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: image/webp\r\n\r\n`),
    optimized.data, Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const endpoint = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(config.bucket)}/o?uploadType=multipart&ifGenerationMatch=0`
  const uploaded = await request(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body), signal: AbortSignal.timeout(20_000),
  })
  let publicToken: string = downloadToken
  if (uploaded.status === 412 || uploaded.status === 409) {
    const existing = await request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(config.bucket)}/o/${encodeURIComponent(objectPath)}?fields=name,contentType,size,metadata`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    })
    if (!existing.ok) throw new CatalogImageError('Existing catalog image cannot be verified', 503)
    const stored = await existing.json() as { name?: string; contentType?: string; size?: string; metadata?: Record<string, string> }
    const existingToken = stored.metadata?.firebaseStorageDownloadTokens?.split(',')[0]?.trim()
    if (stored.name !== objectPath || stored.contentType !== 'image/webp' || Number(stored.size) !== optimized.data.length ||
        stored.metadata?.sha256 !== sha256 || !existingToken || !UUID.test(existingToken)) {
      throw new CatalogImageError('Existing catalog image has incompatible metadata', 503)
    }
    publicToken = existingToken
  } else if (!uploaded.ok) {
    throw new CatalogImageError(`Catalog image upload failed (${uploaded.status})`, 503)
  }
  const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(config.bucket)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${publicToken}`
  const downloaded = await request(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
  if (!downloaded.ok || !downloaded.headers.get('content-type')?.toLowerCase().startsWith('image/webp')) {
    throw new CatalogImageError('Uploaded catalog image is not publicly accessible', 503)
  }
  const content = Buffer.from(await downloaded.arrayBuffer())
  if (content.length !== optimized.data.length || createHash('sha256').update(content).digest('hex') !== sha256) {
    throw new CatalogImageError('Public catalog image verification failed', 503)
  }
  return {
    url, alt: `${input.model} — ${input.color}`, width: optimized.info.width, height: optimized.info.height,
    bytes: optimized.data.length, mimeType: 'image/webp', sha256, objectPath, sourceFilename: input.filename,
  }
}
