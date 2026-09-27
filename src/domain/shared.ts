export type EntityId = string
export type ISODateTime = string
export type CurrencyCode = string

export interface TenantScoped { tenantId: EntityId }
export interface Timestamped { createdAt: ISODateTime; updatedAt: ISODateTime }

export function belongsToTenant(entity: TenantScoped, tenantId: EntityId): boolean {
  return entity.tenantId === tenantId
}

export function filterByTenant<T extends TenantScoped>(items: readonly T[], tenantId: EntityId): T[] {
  return items.filter((item) => belongsToTenant(item, tenantId))
}
