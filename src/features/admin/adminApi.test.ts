import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { currentUser } = vi.hoisted(() => ({
  currentUser: { getIdToken: vi.fn(async () => 'admin-test-token') },
}))
vi.mock('../../auth/firebaseClient', () => ({ auth: { currentUser } }))

import { adminApi } from './adminApi'

const response = (status: number, body: Record<string, unknown>, retryAfter?: string) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...(retryAfter ? { 'retry-after': retryAfter } : {}) },
})

describe('admin read requests', () => {
  beforeEach(() => { currentUser.getIdToken.mockClear() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('deduplicates concurrent reads, caches briefly, and invalidates after a mutation', async () => {
    const fetchMock = vi.fn(async () => response(200, { ok: true, data: { conversations: [], alerts: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    const input = { testKey: 'dedupe' }
    const [first, second] = await Promise.all([
      adminApi('commandCenterSnapshot', 'tenant-floes', input),
      adminApi('commandCenterSnapshot', 'tenant-floes', input),
    ])
    expect(first).toEqual(second)
    await adminApi('commandCenterSnapshot', 'tenant-floes', input)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await adminApi('markOperationalAlertRead', 'tenant-floes', { alertId: 'alert-test' })
    await adminApi('commandCenterSnapshot', 'tenant-floes', input)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('backs off repeated reads after 429 and resumes after the retry window', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, { ok: false, error: 'limited', errorCode: 'UPSTREAM_RATE_LIMITED' }, '15'))
      .mockResolvedValueOnce(response(200, { ok: true, data: [{ tenantId: 'tenant-mg' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const input = { testKey: 'backoff' }

    await expect(adminApi('dashboard', 'tenant-mg', input)).rejects.toThrow('limited')
    await expect(adminApi('dashboard', 'tenant-mg', input)).rejects.toThrow('limited')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(40_000)
    await expect(adminApi('dashboard', 'tenant-mg', input)).resolves.toEqual([{ tenantId: 'tenant-mg' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
