import type { EntityId, Timestamped } from './shared'

export type TenantStatus = 'ACTIVE' | 'PAUSED' | 'ONBOARDING' | 'ARCHIVED'
export interface Tenant extends Timestamped { id: EntityId; slug: string; name: string; status: TenantStatus }
