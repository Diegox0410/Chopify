import { createTenantCommerceState } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'

const expectedProject = 'demo-floes-sandbox'
const expectedHost = '127.0.0.1:8081'
if (process.env.FIRESTORE_EMULATOR_HOST !== expectedHost || process.env.FIREBASE_PROJECT_ID !== expectedProject) {
  throw new Error('Refusing Firestore verification outside the approved loopback demo project')
}

const mode = process.argv[2]
const tenantId = 'tenant-floes'
const store = new FirestoreCommerceStateStore(process.env)
const marker = (state: ReturnType<typeof createTenantCommerceState>) => state.orders.audit.find((event) => event.id === 'emulator-recovery-marker')?.metadata?.marker

if (mode === 'seed') {
  const state = createTenantCommerceState(tenantId)
  state.orders.audit.push({
    id: 'emulator-recovery-marker', tenantId, entityType: 'SANDBOX_CHECK', entityId: tenantId,
    type: 'SYNTHETIC_STATE_RECOVERY', actorType: 'SYSTEM', timestamp: '2026-10-14T19:50:00.000Z',
    metadata: { marker: 'FLOES_PREVIEW_SYNTHETIC_20261014' },
  })
  const current = await store.load(tenantId)
  if (current) throw new Error('Clear the prior emulator-only fixture before seed; this verifier never overwrites persisted state')
  const version = await store.save(tenantId, state, null)
  const saved = await store.load(tenantId)
  if (!saved || saved.version !== version || marker(saved.state) !== 'FLOES_PREVIEW_SYNTHETIC_20261014') {
    throw new Error('Firestore emulator did not round-trip the synthetic state')
  }
  console.log('SYNTHETIC_STATE_WRITE_READ=PASS')
  console.log(`DOCUMENT=${tenantId};VERSION_PRESENT=${Boolean(version)}`)
} else if (mode === 'recover') {
  const recovered = await store.load(tenantId)
  if (!recovered || marker(recovered.state) !== 'FLOES_PREVIEW_SYNTHETIC_20261014') {
    throw new Error('Firestore emulator did not recover the exported synthetic state')
  }
  console.log('EXPORTED_STATE_RECOVERY=PASS')
  const changed = structuredClone(recovered.state)
  const event = changed.orders.audit.find((item) => item.id === 'emulator-recovery-marker')
  if (!event) throw new Error('Synthetic recovery marker was lost')
  event.metadata = { ...event.metadata, marker: 'FLOES_PREVIEW_SYNTHETIC_RECOVERED_20261014' }
  const nextVersion = await store.save(tenantId, changed, recovered.version)
  const afterUpdate = await store.load(tenantId)
  if (!afterUpdate || afterUpdate.version !== nextVersion || marker(afterUpdate.state) !== 'FLOES_PREVIEW_SYNTHETIC_RECOVERED_20261014') {
    throw new Error('Firestore emulator failed post-recovery versioned update')
  }
  console.log('VERSIONED_POST_RECOVERY_WRITE=PASS')
} else {
  throw new Error('Use `seed` on an empty emulator, export on shutdown, then `recover` after importing the data')
}
