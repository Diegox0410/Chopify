import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTenantCommerceState } from '../application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from './firestoreCommerceStateStore.js'

afterEach(() => vi.unstubAllGlobals())

describe('Firestore sandbox emulator adapter', () => {
  it('uses loopback demo project without server credentials and round-trips the commerce state', async () => {
    const state = createTenantCommerceState('tenant-floes')
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/documents:commit')) return new Response(JSON.stringify({ writeResults: [{ updateTime: '2026-10-14T00:01:00Z' }] }), { status: 200 })
      if (init.method === 'POST') return new Response(JSON.stringify({ updateTime: '2026-10-14T00:00:00Z' }), { status: 200 })
      return new Response(JSON.stringify({ updateTime: '2026-10-14T00:00:00Z', fields: { stateJson: { stringValue: JSON.stringify(state) } } }), { status: 200 })
    })
    const store = new FirestoreCommerceStateStore({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8081', FIREBASE_PROJECT_ID: 'demo-floes-sandbox' } as NodeJS.ProcessEnv)
    const createdVersion = await store.save('tenant-floes', state, null)
    const restored = await new FirestoreCommerceStateStore({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8081', FIREBASE_PROJECT_ID: 'demo-floes-sandbox' } as NodeJS.ProcessEnv).load('tenant-floes')
    expect(restored?.state).toEqual(state)
    expect(await store.save('tenant-floes', state, createdVersion)).toBe('2026-10-14T00:01:00Z')
    expect(calls.every(call => call.url.startsWith('http://127.0.0.1:8081/v1/projects/demo-floes-sandbox/'))).toBe(true)
    expect(calls.every(call => new Headers(call.init.headers).get('authorization') === 'Bearer owner')).toBe(true)
    const commit = calls.find(call => call.url.endsWith('/documents:commit'))
    expect(commit?.url).toBe('http://127.0.0.1:8081/v1/projects/demo-floes-sandbox/databases/(default)/documents:commit')
    expect(JSON.parse(String(commit?.init.body)).writes[0].currentDocument.updateTime).toBe(createdVersion)
  })

  it('rejects emulator hosts that could send sandbox requests to a remote server', async () => {
    const store = new FirestoreCommerceStateStore({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443', FIREBASE_PROJECT_ID: 'demo-floes-sandbox' } as NodeJS.ProcessEnv)
    await expect(store.load('tenant-floes')).rejects.toThrow('loopback-only')
  })
})
