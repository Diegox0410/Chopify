import type { EntityId, ISODateTime, TenantScoped } from './shared.js'

export type AutomationStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
export type AutomationTriggerType = 'ORDER_CREATED' | 'PAYMENT_CONFIRMED' | 'ORDER_DISPATCHED' | 'ORDER_DELIVERED' | 'CART_ABANDONED' | 'REPURCHASE_WINDOW_REACHED'
export type AutomationActionType = 'CREATE_FOLLOW_UP' | 'CREATE_REPURCHASE_OPPORTUNITY' | 'REQUEST_HUMAN_ESCALATION' | 'SEND_MESSAGE_REQUEST'
export interface AutomationTrigger { type: AutomationTriggerType; config?: Readonly<Record<string, string | number | boolean>> }
export interface AutomationCondition { field: string; operator: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN'; value: string | number | boolean | readonly string[] }
export interface AutomationAction { type: AutomationActionType; config?: Readonly<Record<string, string | number | boolean>> }
export interface AutomationDefinition extends TenantScoped { id: EntityId; name: string; status: AutomationStatus; trigger: AutomationTrigger; conditions: readonly AutomationCondition[]; actions: readonly AutomationAction[] }
export const isExecutableAutomation = (definition: AutomationDefinition) => definition.status === 'ACTIVE' && definition.actions.length > 0

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4
export type AutomationEventData = Readonly<Record<string, string | number | boolean | null | undefined>>
export interface AutomationEvent extends TenantScoped {
  id: EntityId; type: AutomationTriggerType; occurredAt: ISODateTime; entityType: string; entityId: EntityId
  customerId?: EntityId; conversationId?: EntityId; orderId?: EntityId; data: AutomationEventData
}
export interface AutomationEvaluation extends TenantScoped {
  id: EntityId; eventId: EntityId; automationId: EntityId; matched: boolean; reason: string; createdAt: ISODateTime
}
export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'DEAD_LETTER'
export interface MessageRequestPayload {
  kind: 'MESSAGE_REQUEST'; channel: 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'WEB' | 'OTHER'
  customerId: EntityId; conversationId?: EntityId; templateKey: string; variables?: Readonly<Record<string, string>>
}
export interface FollowUpPayload { kind: 'FOLLOW_UP'; customerId: EntityId; title: string; dueAt?: ISODateTime }
export interface RepurchasePayload { kind: 'REPURCHASE'; customerId: EntityId; title: string; dueAt?: ISODateTime }
export interface EscalationPayload { kind: 'ESCALATION'; customerId?: EntityId; conversationId?: EntityId; orderId?: EntityId; reason: 'PAYMENT_ISSUE' | 'SYSTEM_ERROR' | 'OTHER'; summary: string }
export type OutboxPayload = MessageRequestPayload | FollowUpPayload | RepurchasePayload | EscalationPayload
export interface OutboxEvent extends TenantScoped {
  id: EntityId; automationId: EntityId; sourceEventId: EntityId; actionType: AutomationActionType
  status: OutboxStatus; payload: OutboxPayload; attempts: number; maxAttempts: number
  availableAt: ISODateTime; createdAt: ISODateTime; updatedAt: ISODateTime; processedAt?: ISODateTime; lastError?: string
}
export interface AutomationExecution extends TenantScoped {
  id: EntityId; outboxEventId: EntityId; automationId: EntityId; actionType: AutomationActionType
  status: 'SUCCEEDED' | 'FAILED'; attempt: number; startedAt: ISODateTime; finishedAt: ISODateTime; error?: string
}

const read = (data: AutomationEventData, field: string) => data[field]
export function matchesAutomation(definition: AutomationDefinition, event: AutomationEvent): boolean {
  if (!isExecutableAutomation(definition) || definition.tenantId !== event.tenantId || definition.trigger.type !== event.type) return false
  return definition.conditions.every((condition) => {
    const actual = read(event.data, condition.field)
    const expected = condition.value
    switch (condition.operator) {
      case 'EQ': return actual === expected
      case 'NEQ': return actual !== expected
      case 'GT': return typeof actual === 'number' && typeof expected === 'number' && actual > expected
      case 'GTE': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
      case 'LT': return typeof actual === 'number' && typeof expected === 'number' && actual < expected
      case 'LTE': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
      case 'IN': return Array.isArray(expected) && expected.includes(String(actual))
    }
  })
}
export function startOutbox(item: OutboxEvent, at: ISODateTime): OutboxEvent {
  if (item.status !== 'PENDING' && item.status !== 'FAILED') throw new Error('Outbox event is not executable')
  if (item.attempts >= item.maxAttempts) throw new Error('Outbox retry limit reached')
  return { ...item, status: 'PROCESSING', attempts: item.attempts + 1, updatedAt: at, lastError: undefined }
}
export const completeOutbox = (item: OutboxEvent, at: ISODateTime): OutboxEvent => {
  if (item.status !== 'PROCESSING') throw new Error('Only processing outbox events can complete')
  return { ...item, status: 'SENT', updatedAt: at, processedAt: at }
}
export const failOutbox = (item: OutboxEvent, at: ISODateTime, error: string): OutboxEvent => {
  if (item.status !== 'PROCESSING') throw new Error('Only processing outbox events can fail')
  const terminal = item.attempts >= item.maxAttempts
  return { ...item, status: terminal ? 'DEAD_LETTER' : 'FAILED', updatedAt: at, lastError: error.trim() || 'Unknown executor error' }
}
