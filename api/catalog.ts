import { PersistentCommerceRuntime } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'

interface Request {
  method?: string
  query?: Record<string, string | string[] | undefined>
}

interface Response {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

type CatalogProduct = Record<string, unknown>
type CatalogEnvironment = Record<string, string | undefined>

const runtime = new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
const value = (entry: string | string[] | undefined) => Array.isArray(entry) ? entry[0] : entry
const PUBLIC_TENANTS = new Set(['tenant-floes', 'tenant-mg', 'tenant-dgng'])
const CACHE_TTL_MS = 15_000
const STALE_TTL_MS = 60_000

export function createCatalogHandler({
  environment = process.env,
  loadCatalog = (tenantId: string) => runtime.execute({ operation: 'searchProducts', tenantId, input: { query: '', limit: 500 } }) as Promise<readonly CatalogProduct[]>,
  now = () => Date.now(),
  warn = (...args: unknown[]) => console.warn(...args),
}: {
  environment?: CatalogEnvironment
  loadCatalog?: (tenantId: string) => Promise<readonly CatalogProduct[]>
  now?: () => number
  warn?: (...args: unknown[]) => void
} = {}) {
  const cache = new Map<string, { products: readonly CatalogProduct[]; expiresAt: number; staleUntil: number }>()
  const loads = new Map<string, Promise<readonly CatalogProduct[]>>()

  return async function catalogHandler(req: Request, res: Response) {
    const startedAt = now()
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('X-Chopify-Commerce-Collection', environment.CHOPIFY_COMMERCE_STATE_COLLECTION?.trim() || 'chopifyCommerceRuntime')
    const tenantId = value(req.query?.tenant)?.trim()
    if (!tenantId) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Explicit tenant is required' }))
      return
    }
    const configuredTenants = (environment.CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS || environment.CHOPIFY_COMMERCE_ALLOWED_TENANTS ||
      (environment.VERCEL_ENV === 'preview' ? 'tenant-floes' : 'tenant-floes,tenant-mg,tenant-dgng')).split(',').map(tenant => tenant.trim())
    if (!PUBLIC_TENANTS.has(tenantId) || !configuredTenants.includes(tenantId)) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Catalog not found' }))
      return
    }

    const requestedSlug = value(req.query?.slug)
    const respond = (products: readonly CatalogProduct[], cacheState: 'HIT' | 'MISS' | 'STALE') => {
      const elapsed = now() - startedAt
      res.setHeader('Cache-Control', cacheState === 'STALE' ? 'public, s-maxage=5, stale-while-revalidate=30' : 'public, s-maxage=15, stale-while-revalidate=60')
      res.setHeader('X-Catalog-Cache', cacheState)
      res.setHeader('X-Catalog-Read-Ms', String(elapsed))
      res.statusCode = 200
      res.end(JSON.stringify(requestedSlug ? products.find(item => item.slug === requestedSlug) ?? null : products))
    }

    const current = now()
    const cached = cache.get(tenantId)
    if (cached && cached.expiresAt > current) {
      respond(cached.products, 'HIT')
      return
    }
    try {
      let load = loads.get(tenantId)
      if (!load) {
        load = loadCatalog(tenantId).then(products => products.map(item => {
          const safe = { ...item }
          delete safe.ganoBotNotes
          return safe
        }))
        loads.set(tenantId, load)
      }
      const products = await load
      const timestamp = now()
      cache.set(tenantId, { products, expiresAt: timestamp + CACHE_TTL_MS, staleUntil: timestamp + CACHE_TTL_MS + STALE_TTL_MS })
      respond(products, 'MISS')
    } catch {
      const stale = cache.get(tenantId)
      if (stale && stale.staleUntil > now()) {
        respond(stale.products, 'STALE')
        return
      }
      warn('FLOES public catalog read failed', { tenantId, durationMs: now() - startedAt })
      res.setHeader('Cache-Control', 'no-store')
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'Catalog temporarily unavailable' }))
    } finally {
      loads.delete(tenantId)
    }
  }
}

export default createCatalogHandler()
