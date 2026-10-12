export function cachedAdminRead<T>(key: string, load: () => Promise<T> | T, options?: { ttlMs?: number; failureTtlMs?: number }): Promise<T>
export function invalidateAdminReadCache(tenantId: string): void
export function clearAdminReadCacheForTests(): void
