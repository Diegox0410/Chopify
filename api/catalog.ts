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

const runtime = new PersistentCommerceRuntime(new FirestoreCommerceStateStore())

const value = (entry: string | string[] | undefined) =>
  Array.isArray(entry) ? entry[0] : entry

const PUBLIC_TENANTS = new Set([
  'tenant-floes',
  'tenant-mg',
  'tenant-dgng',
])

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Chopify-Commerce-Collection', process.env.CHOPIFY_COMMERCE_STATE_COLLECTION?.trim() || 'chopifyCommerceRuntime')

  const requestedTenant = value(req.query?.tenant)?.trim()
  if (!requestedTenant) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Explicit tenant is required' }))
    return
  }
  const tenantId = requestedTenant
  const configuredTenants = (process.env.CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS || process.env.CHOPIFY_COMMERCE_ALLOWED_TENANTS ||
    (process.env.VERCEL_ENV === 'preview' ? 'tenant-floes' : 'tenant-floes,tenant-mg,tenant-dgng')).split(',').map(tenant => tenant.trim())

  if (!PUBLIC_TENANTS.has(tenantId) || !configuredTenants.includes(tenantId)) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Catalog not found' }))
    return
  }

  try {
    const products = await runtime.execute({
      operation: 'searchProducts',
      tenantId,
      input: { query: '', limit: 500 },
    }) as readonly Record<string, unknown>[]

    const slug = value(req.query?.slug)
    const publicProducts = products.map(item => { const safe = { ...item }; delete safe.ganoBotNotes; return safe })

    res.statusCode = 200
    res.end(JSON.stringify(
      slug
        ? publicProducts.find((item) => item.slug === slug) ?? null
        : publicProducts,
    ))
  } catch (error) {
    res.statusCode = 500
    res.end(JSON.stringify({
      error: error instanceof Error ? error.message : 'Catalog unavailable',
    }))
  }
}
