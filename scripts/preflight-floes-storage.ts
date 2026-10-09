import { loadEnvFile } from 'node:process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preflightCatalogStorage } from '../src/infrastructure/catalogImageStorage.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
try { loadEnvFile(resolve(root, '.env.local')) }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to load local server environment', { cause: error }) }

preflightCatalogStorage().then(({ bucket, projectId, projectNumber }) => {
  console.info(JSON.stringify({ stage: 'catalog_storage_preflight_passed', bucket, projectId, projectNumber }))
}).catch(error => {
  console.error(error instanceof Error ? error.message : 'Catalog storage preflight failed')
  process.exitCode = 1
})
