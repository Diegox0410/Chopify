import { CatalogImageError, FirebaseCatalogStorage, type CatalogImageStorage } from './catalogImageStorage.js'
import { PublicCatalogStorage } from './publicCatalogStorage.js'
import type { ServerEnvironment, ServerFetch } from './serviceAccountOAuth.js'

export interface CatalogImageStorageProviderOptions {
  env?: ServerEnvironment
  fetch?: ServerFetch
  publicDirectory?: string
}

/** Public static images are the zero-cost default; Firebase remains an explicit optional provider. */
export function createCatalogImageStorage(options: CatalogImageStorageProviderOptions = {}): CatalogImageStorage {
  const env = options.env ?? process.env
  const provider = env.CATALOG_IMAGE_STORAGE_PROVIDER?.trim().toLowerCase() || 'public'
  if (provider === 'public') {
    return new PublicCatalogStorage({ env, fetch: options.fetch, publicDirectory: options.publicDirectory })
  }
  if (provider === 'firebase') return new FirebaseCatalogStorage({ env, fetch: options.fetch })
  throw new CatalogImageError('Unsupported catalog image storage provider', 503)
}
