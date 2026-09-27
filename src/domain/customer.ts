import type { EntityId, TenantScoped, Timestamped } from './shared'

export interface Customer extends TenantScoped, Timestamped {
  id: EntityId
  name: string
  phone?: string
  email?: string
  acquisitionSource?: string
}
