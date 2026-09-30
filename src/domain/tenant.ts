import type { EntityId, Timestamped } from './shared.js'

export type TenantStatus = 'ACTIVE' | 'PAUSED' | 'ONBOARDING' | 'ARCHIVED'
export interface Tenant extends Timestamped { id: EntityId; slug: string; name: string; status: TenantStatus }
