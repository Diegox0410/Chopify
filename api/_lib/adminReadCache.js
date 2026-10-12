const values = new Map()
const pending = new Map()
const failures = new Map()

export async function cachedAdminRead(key, load, { ttlMs = 10_000, failureTtlMs = 10_000 } = {}) {
  const now = Date.now()
  const cached = values.get(key)
  if (cached && cached.expiresAt > now) return cached.value
  if (cached) values.delete(key)

  const failure = failures.get(key)
  if (failure && failure.expiresAt > now) throw failure.error
  if (failure) failures.delete(key)

  const inFlight = pending.get(key)
  if (inFlight) return inFlight

  const request = Promise.resolve().then(load).then(value => {
    values.set(key, { value, expiresAt: Date.now() + ttlMs })
    failures.delete(key)
    return value
  }).catch(error => {
    const status = Number(error?.upstreamStatus || error?.status)
    if (status === 429 || status === 503) failures.set(key, { error, expiresAt: Date.now() + failureTtlMs })
    throw error
  }).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

export function invalidateAdminReadCache(tenantId) {
  const suffix = `:${tenantId}`
  const shouldInvalidate = key => key.endsWith(suffix) || key.startsWith('notifications:') || key.startsWith('live-documents:')
  for (const key of values.keys()) if (shouldInvalidate(key)) values.delete(key)
  for (const key of failures.keys()) if (shouldInvalidate(key)) failures.delete(key)
}

export function clearAdminReadCacheForTests() {
  values.clear()
  pending.clear()
  failures.clear()
}
