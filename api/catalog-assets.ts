import { CatalogImageError, uploadCatalogImage, validateCatalogImageInput } from '../src/infrastructure/catalogImageStorage.js'
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
    input = validateCatalogImageInput(input)
    const asset = await uploadCatalogImage(input)
    return json(res, 200, { ok: true, data: asset })
  } catch (error) {
    if (error instanceof CatalogImageError) return json(res, error.status, { ok: false, error: error.message })
    console.error(JSON.stringify({ service: 'catalog-assets', stage: 'upload_failed', tenantId: 'tenant-floes' }))
    return json(res, 503, { ok: false, error: 'Catalog image storage is unavailable' })
  }
}
