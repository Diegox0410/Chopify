import type { EntityId, TenantScoped, Timestamped } from './shared'

export type Channel = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'WEB' | 'OTHER'
export type ConversationStatus = 'OPEN' | 'AUTOMATED' | 'HUMAN_REQUIRED' | 'CLOSED'
export type AssignedMode = 'AUTOMATION' | 'HUMAN'
export interface Conversation extends TenantScoped, Timestamped {
  id: EntityId
  customerId: EntityId
  channel: Channel
  status: ConversationStatus
  assignedMode: AssignedMode
  automationAgent?: string
}
