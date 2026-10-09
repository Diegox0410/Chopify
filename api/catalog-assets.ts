import { CatalogImageError, validateCatalogImageInput, validateCatalogImageReference } from '../src/infrastructure/catalogImageStorage.js'
import { createCatalogImageStorage } from '../src/infrastructure/catalogImageStorageProvider.js'
import { publicCatalogImagePath } from '../src/infrastructure/publicCatalogStorage.js'
import { authorizePlatformOwner } from './_lib/firebaseAuth.js'

interface Request { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface Response { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }

const json = (res: Response, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(JSON.stringify(body))
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const auth = await authorizePlatformOwner(req)
  if (!auth.ok) return json(res, auth.status, { error: auth.error })
  let input: unknown
  try {
    if (typeof req.body === 'string') {
      if (req.body.length > 4_200_000) throw new CatalogImageError('Image upload body is too large', 413)
      try { input = JSON.parse(req.body) }
      catch { throw new CatalogImageError('Invalid JSON body') }
    } else { input = req.body }
    const storage = createCatalogImageStorage()
    let asset
    if (storage.provider === 'public') {
      if (input && typeof input === 'object' && !Array.isArray(input) && 'dataBase64' in input) {
        throw new CatalogImageError('Public catalog images are synchronized from the FLOES Commerce repository', 409)
      }
      const reference = validateCatalogImageReference(input)
      if (!await storage.exists(reference)) throw new CatalogImageError('Public catalog image is missing; synchronize the asset first', 404)
      const url = await storage.getPublicUrl(reference)
      if (!url) throw new CatalogImageError('Public catalog image URL is unavailable', 503)
      asset = {
        url, alt: `${reference.model} — ${reference.color}`, width: 0, height: 0, bytes: 0,
        mimeType: 'image/jpeg' as const, sha256: '', objectPath: publicCatalogImagePath(reference.model, reference.color), sourceFilename: '',
      }
    } else {
      asset = await storage.upload(validateCatalogImageInput(input))
    }
    return json(res, 200, { ok: true, data: asset })
  } catch (error) {
    if (error instanceof CatalogImageError) return json(res, error.status, { ok: false, error: error.message })
    console.error(JSON.stringify({ service: 'catalog-assets', stage: 'upload_failed', tenantId: 'tenant-floes' }))
    return json(res, 503, { ok: false, error: 'Catalog image storage is unavailable' })
  }
}
