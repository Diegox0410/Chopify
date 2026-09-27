import type { EntityId, TenantScoped, Timestamped } from './shared'

export type CustomerStatus = 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'

export interface Customer extends TenantScoped, Timestamped {
  id: EntityId
  name: string
  phone?: string
  email?: string
  status: CustomerStatus
  acquisitionSource?: string
  tags?: readonly string[]
  lastInteractionAt?: string
  lastPurchaseAt?: string
}

export type CustomerIdentityChannel = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'WEB' | 'OTHER'
export interface CustomerIdentity extends TenantScoped {
  id: EntityId
  customerId: EntityId
  channel: CustomerIdentityChannel
  externalIdentifier: string
  createdAt: string
  updatedAt?: string
}
