import type { EntityId, TenantScoped, Timestamped } from './shared.js'

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
  assignedUserId?: EntityId
  startedAt: string
  lastActivityAt: string
  closedAt?: string
}

function touch(conversation: Conversation, at: string): Conversation {
  return { ...conversation, updatedAt: at, lastActivityAt: at }
}

export function requireHumanConversation(conversation: Conversation, at: string): Conversation {
  if (conversation.status === 'CLOSED') throw new Error('Closed conversation must be explicitly reopened')
  return { ...touch(conversation, at), status: 'HUMAN_REQUIRED', assignedMode: 'AUTOMATION', assignedUserId: undefined }
}

export function assignHumanConversation(conversation: Conversation, userId: EntityId, at: string): Conversation {
  if (conversation.status !== 'HUMAN_REQUIRED') throw new Error('Only a human-required conversation can be assigned')
  if (!userId.trim()) throw new Error('assignedUserId is required')
  return { ...touch(conversation, at), status: 'OPEN', assignedMode: 'HUMAN', assignedUserId: userId }
}

export function closeConversation(conversation: Conversation, at: string): Conversation {
  if (conversation.status === 'CLOSED') throw new Error('Conversation is already closed')
  return { ...touch(conversation, at), status: 'CLOSED', closedAt: at }
}

export function reopenConversation(conversation: Conversation, at: string): Conversation {
  if (conversation.status !== 'CLOSED') throw new Error('Only a closed conversation can be reopened')
  return { ...touch(conversation, at), status: 'OPEN', assignedMode: 'HUMAN', closedAt: undefined }
}
