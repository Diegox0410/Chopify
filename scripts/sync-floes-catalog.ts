import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { readCatalogFile } from '../src/application/catalogFiles.js'
import { prepareFloesCatalogSync } from '../src/application/floesCatalogSynchronizer.js'
import type { CommerceProduct } from '../src/domain/commerce.js'
import type { CommerceRuntimeState } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'

const PRODUCTION_PROJECT = 'chopify-f9b1c'
const PRODUCTION_COLLECTION = 'chopifyCommerceRuntime'
const TENANT_ID = 'tenant-floes'
const CONFIRM_TARGET = `PRODUCTION:${PRODUCTION_PROJECT}:${PRODUCTION_COLLECTION}:${TENANT_ID}`
const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)
const valueAfter = (flag: string) => {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const inside = (root: string, candidate: string) => {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function usage(): never {
  throw new Error([
    'Usage:',
    '  npm run sync:floes-catalog -- --dry-run --source <master.xlsx> --snapshot <owner-snapshot.json> [--plan-out <safe-path>]',
    '  npm run sync:floes-catalog -- --write --confirm-write --confirm-target PRODUCTION:chopify-f9b1c:chopifyCommerceRuntime:tenant-floes --source <master.xlsx> --plan <dry-run-plan.json> --backup-dir <outside-repos>',
    '  npm run sync:floes-catalog -- --rollback <backup.json> --confirm-write --confirm-target PRODUCTION:chopify-f9b1c:chopifyCommerceRuntime:tenant-floes',
    'The write and rollback modes require ALLOW_FLOES_PRODUCTION_CATALOG_SYNC=yes and an exact Production Firebase target.',
  ].join('\n'))
}

function toSnapshotProduct(raw: Record<string, unknown>): CommerceProduct {
  const variants = Array.isArray(raw.variants) ? raw.variants as Array<Record<string, unknown>> : []
  return {
    id: String(raw.productId ?? ''),
    tenantId: String(raw.tenantId ?? ''),
    sku: String(raw.sku ?? ''),
    slug: String(raw.slug ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    commercialSummary: String(raw.description ?? ''),
    category: String(raw.category ?? ''),
    status: raw.status === 'ARCHIVED' ? 'ARCHIVED' : raw.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE',
    visibility: raw.visibility === 'HIDDEN' ? 'HIDDEN' : 'VISIBLE',
    fulfillmentMode: 'STOCK',
    pricingStatus: raw.pricingStatus === 'PENDING' ? 'PENDING' : 'READY',
    costCents: null,
    percentage: null,
    percentageType: null,
    salePriceCents: typeof raw.salePriceCents === 'number' ? raw.salePriceCents : null,
    currency: typeof raw.currency === 'string' ? raw.currency : null,
    images: Array.isArray(raw.images) ? raw.images as CommerceProduct['images'] : [],
    variants: variants.map(variant => ({
      id: String(variant.variantId ?? ''),
      sku: String(variant.sku ?? ''),
      color: typeof variant.color === 'string' ? variant.color : null,
      status: variant.status === 'ARCHIVED' ? 'ARCHIVED' : variant.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE',
      visibility: variant.visibility === 'HIDDEN' ? 'HIDDEN' : 'VISIBLE',
      images: Array.isArray(variant.images) ? variant.images as CommerceProduct['images'] : [],
      stock: typeof variant.stock === 'number' ? variant.stock : null,
      importedStock: typeof variant.importedStock === 'number' ? variant.importedStock : typeof variant.stock === 'number' ? variant.stock : null,
      available: variant.available === true,
      salePriceCents: typeof variant.salePriceCents === 'number' ? variant.salePriceCents : null,
      promotionalPriceCents: typeof variant.promotionalPriceCents === 'number' ? variant.promotionalPriceCents : null,
      sizes: Array.isArray(variant.sizes) ? variant.sizes.map(String) : typeof variant.size === 'string' ? [variant.size] : [],
      fulfillmentMode: 'STOCK',
    })),
  }
}

async function readRows(sourcePath: string) {
  const bytes = await readFile(sourcePath)
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return { rows: await readCatalogFile(basename(sourcePath), input), sourceHash: sha256(bytes) }
}

async function readSnapshot(path: string) {
  const bytes = await readFile(path)
  const raw = JSON.parse(bytes.toString('utf8')) as { tenantId?: string; products?: unknown }
  if (raw.tenantId !== TENANT_ID || !Array.isArray(raw.products)) throw new Error('Owner snapshot must contain tenant-floes products')
  return { products: raw.products.map(product => toSnapshotProduct(product as Record<string, unknown>)), snapshotHash: sha256(bytes) }
}

function catalogFingerprint(products: readonly CommerceProduct[]) {
  const projection = [...products].sort((left, right) => left.id.localeCompare(right.id)).map(product => ({
    id: product.id,
    tenantId: product.tenantId,
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    category: product.category,
    description: product.description,
    status: product.status,
    visibility: product.visibility,
    pricingStatus: product.pricingStatus,
    salePriceCents: product.salePriceCents,
    promotionalPriceCents: product.promotionalPriceCents ?? null,
    currency: product.currency,
    images: product.images.map(image => ({ url: image.url, alt: image.alt })),
    variants: [...product.variants].sort((left, right) => left.sku.localeCompare(right.sku)).map(variant => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color,
      status: variant.status,
      visibility: variant.visibility,
      stock: variant.stock,
      importedStock: variant.importedStock ?? variant.stock ?? null,
      salePriceCents: variant.salePriceCents ?? null,
      promotionalPriceCents: variant.promotionalPriceCents ?? null,
      available: variant.available ?? null,
      sizes: variant.sizes ?? [],
      size: variant.size ?? null,
      images: variant.images.map(image => ({ url: image.url, alt: image.alt })),
    })),
  }))
  return sha256(stable(projection))
}

async function restrictBackupFile(path: string) {
  if (process.platform !== 'win32') return
  const username = process.env.USERNAME
  const domain = process.env.USERDOMAIN
  if (!username || !domain) throw new Error('Could not identify the Windows user for private backup ACLs')
  execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${domain}\\${username}:(F)`], { stdio: 'ignore' })
}

async function ensureOutsideRepositories(path: string) {
  const target = resolve(path)
  const cwd = resolve(process.cwd())
  const desktop = dirname(cwd)
  const roots = [
    cwd,
    resolve(desktop, 'GANO_BOT'),
    resolve(desktop, '..', 'floes-commerce'),
  ]
  for (const root of roots) {
    try {
      if (inside(root, target)) throw new Error('Snapshot/backup files must be kept outside all three repositories')
    } catch (error) {
      if (error instanceof Error && error.message.includes('outside all three')) throw error
    }
  }
  return target
}

function mutationDigest(sync: ReturnType<typeof prepareFloesCatalogSync>) {
  return sha256(stable({ diff: sync.diff, models: sync.modelSummary }))
}

function report(sync: ReturnType<typeof prepareFloesCatalogSync>, sourceHash: string, snapshotHash: string, existingProducts: readonly CommerceProduct[]) {
  const digest = mutationDigest(sync)
  return {
    mode: 'dry-run',
    target: 'LOCAL SNAPSHOT ONLY',
    sourceSha256: sourceHash,
    snapshotSha256: snapshotHash,
    catalogFingerprintSha256: catalogFingerprint(existingProducts),
    planDigest: digest,
    summary: sync.summary,
    models: sync.modelSummary,
    exactNewVariantDiff: sync.diff,
  }
}

async function validateWriteAuthorization() {
  if (!has('--confirm-write')) throw new Error('Production write requires --confirm-write')
  if (valueAfter('--confirm-target') !== CONFIRM_TARGET) throw new Error('Production write requires the exact Production destination confirmation')
  if (process.env.ALLOW_FLOES_PRODUCTION_CATALOG_SYNC !== 'yes') throw new Error('Production write requires ALLOW_FLOES_PRODUCTION_CATALOG_SYNC=yes')
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') throw new Error('Refusing to write while VERCEL_ENV is not Production')
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}') as { project_id?: string }
  if (account.project_id !== PRODUCTION_PROJECT || process.env.CHOPIFY_FIREBASE_PROJECT_ID !== PRODUCTION_PROJECT) {
    throw new Error('Firebase credentials do not target the approved Chopify Production project')
  }
  if ((process.env.CHOPIFY_COMMERCE_STATE_COLLECTION?.trim() || PRODUCTION_COLLECTION) !== PRODUCTION_COLLECTION) {
    throw new Error('Commerce state collection does not match the approved Production target')
  }
}

async function dryRun() {
  if (!has('--dry-run') || has('--write') || has('--rollback')) usage()
  const sourcePath = valueAfter('--source') ?? resolve(process.cwd(), 'Plantilla_Maestra_FLOES_Productos 1700.xlsx')
  const snapshotPath = valueAfter('--snapshot')
  if (!snapshotPath) throw new Error('Dry-run requires an Owner snapshot file and never queries Production')
  const [source, snapshot] = await Promise.all([readRows(sourcePath), readSnapshot(snapshotPath)])
  const sync = prepareFloesCatalogSync(source.rows, snapshot.products)
  const result = report(sync, source.sourceHash, snapshot.snapshotHash, snapshot.products)
  const planOut = valueAfter('--plan-out')
  if (planOut) {
    const safePath = await ensureOutsideRepositories(planOut)
    await mkdir(dirname(safePath), { recursive: true })
    await writeFile(safePath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  }
  console.info(JSON.stringify(result, null, 2))
}

async function writeProduction() {
  if (!has('--write') || has('--dry-run') || has('--rollback')) usage()
  await validateWriteAuthorization()
  const sourcePath = valueAfter('--source')
  const planPath = valueAfter('--plan')
  const backupDirArg = valueAfter('--backup-dir')
  if (!sourcePath || !planPath || !backupDirArg) throw new Error('Production write requires source, a prior dry-run plan, and an external backup directory')
  const [source, priorPlan] = await Promise.all([
    readRows(sourcePath),
    readFile(planPath, 'utf8').then(text => JSON.parse(text) as { sourceSha256?: string; planDigest?: string; catalogFingerprintSha256?: string }),
  ])
  if (priorPlan.sourceSha256 !== source.sourceHash) throw new Error('Source workbook changed since the required dry-run')
  const store = new FirestoreCommerceStateStore(process.env)
  const current = await store.load(TENANT_ID)
  if (!current || current.migrated) throw new Error('Production state is missing or requires a schema migration; manual review is required')
  const sync = prepareFloesCatalogSync(source.rows, current.state.orders.products)
  const digest = mutationDigest(sync)
  if (priorPlan.planDigest !== digest) throw new Error('Production catalog differs from the approved dry-run; regenerate the dry-run and review its diff')
  if (priorPlan.catalogFingerprintSha256 !== catalogFingerprint(current.state.orders.products)) {
    throw new Error('Production catalog changed since the required dry-run; regenerate and review the complete diff')
  }

  const backupDir = await ensureOutsideRepositories(backupDirArg)
  await mkdir(backupDir, { recursive: true })
  await ensureOutsideRepositories(await realpath(backupDir))
  const backupPath = resolve(backupDir, `floes-catalog-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const nextState = structuredClone(current.state)
  const replacements = new Map(sync.products.map(product => [product.id, product]))
  nextState.orders.products = nextState.orders.products.map(product => replacements.get(product.id) ?? product)
  const backup = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    target: CONFIRM_TARGET,
    expectedVersion: current.version,
    beforeStateSha256: sha256(stable(current.state)),
    plannedAfterStateSha256: sha256(stable(nextState)),
    afterVersion: null as string | null,
    state: current.state,
  }
  await writeFile(backupPath, `${JSON.stringify(backup)}\n`, { flag: 'wx', mode: 0o600 })
  await restrictBackupFile(backupPath)
  const savedVersion = await store.save(TENANT_ID, nextState, current.version)
  backup.afterVersion = savedVersion
  const tempBackupPath = `${backupPath}.tmp`
  await writeFile(tempBackupPath, `${JSON.stringify(backup)}\n`, { flag: 'wx', mode: 0o600 })
  await restrictBackupFile(tempBackupPath)
  await rename(tempBackupPath, backupPath)
  await restrictBackupFile(backupPath)

  const readBack = await store.load(TENANT_ID)
  if (!readBack || sha256(stable(readBack.state)) !== backup.plannedAfterStateSha256) {
    throw new Error(`Production read-back mismatch. Restore only with the protected backup: ${backupPath}`)
  }
  console.info(JSON.stringify({
    mode: 'write-complete',
    target: 'Chopify Production / tenant-floes',
    deployment: 'unchanged',
    firestoreWrite: 'PASS',
    readBack: 'PASS',
    backupPath,
    backupAcl: process.platform === 'win32' ? 'owner-only' : 'filesystem-default',
    summary: sync.summary,
    planDigest: digest,
  }, null, 2))
}

async function rollbackProduction() {
  const backupPathArg = valueAfter('--rollback')
  if (!backupPathArg || has('--write') || has('--dry-run')) usage()
  await validateWriteAuthorization()
  const backupPath = await ensureOutsideRepositories(await realpath(await ensureOutsideRepositories(backupPathArg)))
  const backup = JSON.parse(await readFile(backupPath, 'utf8')) as {
    schemaVersion: number; target: string; plannedAfterStateSha256: string; state: CommerceRuntimeState
  }
  if (backup.schemaVersion !== 1 || backup.target !== CONFIRM_TARGET || !backup.plannedAfterStateSha256 || !backup.state) {
    throw new Error('Backup is not a valid FLOES Production catalog rollback file')
  }
  const store = new FirestoreCommerceStateStore(process.env)
  const current = await store.load(TENANT_ID)
  if (!current || sha256(stable(current.state)) !== backup.plannedAfterStateSha256) {
    throw new Error('Current Production state differs from the synchronized snapshot; refusing to overwrite later changes')
  }
  const rollbackPath = `${backupPath}.rollback-state.json`
  await writeFile(rollbackPath, JSON.stringify({ target: CONFIRM_TARGET, state: current.state }), { flag: 'wx', mode: 0o600 })
  await restrictBackupFile(rollbackPath)
  await store.save(TENANT_ID, backup.state, current.version)
  console.info(JSON.stringify({ mode: 'rollback-complete', target: 'Chopify Production / tenant-floes', dataRestore: 'PASS', preRollbackBackupPath: rollbackPath }, null, 2))
}

const sourceAndMode = has('--dry-run') ? dryRun() : has('--write') ? writeProduction() : has('--rollback') ? rollbackProduction() : usage()
await sourceAndMode
