import type { ActorType } from './operations.js'
import type { EntityId, ISODateTime, TenantScoped } from './shared.js'

export type CommercialActivityType =
  | 'CUSTOMER_CREATED' | 'CUSTOMER_UPDATED'
  | 'CONVERSATION_STARTED' | 'CONVERSATION_ESCALATED' | 'CONVERSATION_CLOSED'
  | 'OPPORTUNITY_CREATED' | 'OPPORTUNITY_QUALIFIED' | 'OPPORTUNITY_STAGE_CHANGED'
  | 'OPPORTUNITY_VALUE_CHANGED' | 'OPPORTUNITY_ASSIGNED' | 'OPPORTUNITY_WON'
  | 'OPPORTUNITY_LOST' | 'OPPORTUNITY_ABANDONED' | 'OPPORTUNITY_REOPENED'
  | 'NOTE_ADDED' | 'TASK_CREATED' | 'TASK_COMPLETED' | 'TASK_CANCELLED'
  | 'ORDER_CREATED' | 'ORDER_CANCELLED' | 'PAYMENT_PROOF_SUBMITTED' | 'PAYMENT_REVIEW_STARTED' | 'PAYMENT_APPROVED' | 'PAYMENT_REJECTED'
  | 'INVENTORY_RESERVED' | 'INVENTORY_COMMITTED' | 'INVENTORY_RELEASED' | 'INVENTORY_EXPIRED'
  | 'FULFILLMENT_STARTED' | 'FULFILLMENT_READY' | 'ORDER_DISPATCHED' | 'ORDER_DELIVERED'

export interface CommercialActivity extends TenantScoped {
  id: EntityId
  customerId: EntityId
  opportunityId?: EntityId
  conversationId?: EntityId
  orderId?: EntityId
  paymentId?: EntityId
  type: CommercialActivityType
  actorType: ActorType
  actorId?: EntityId
  occurredAt: ISODateTime
  summary?: string
  metadata?: Readonly<Record<string, string | number | boolean | null>>
}

export interface CommercialNote extends TenantScoped {
  id: EntityId
  customerId: EntityId
  opportunityId?: EntityId
  authorId: EntityId
  body: string
  createdAt: ISODateTime
}

export function createCommercialNote(input: CommercialNote): CommercialNote {
  const body = input.body.trim()
  if (!body) throw new Error('Commercial note cannot be empty')
  return { ...input, body }
}

export type TaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED'
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export interface CommercialTask extends TenantScoped {
  id: EntityId
  customerId?: EntityId
  opportunityId?: EntityId
  conversationId?: EntityId
  title: string
  status: TaskStatus
  priority: TaskPriority
  dueAt?: ISODateTime
  assignedTo?: EntityId
  createdAt: ISODateTime
  completedAt?: ISODateTime
}

export function completeTask(task: CommercialTask, at: ISODateTime): CommercialTask {
  if (task.status !== 'OPEN') throw new Error('Only an open task can be completed')
  return { ...task, status: 'COMPLETED', completedAt: at }
}

export function cancelTask(task: CommercialTask): CommercialTask {
  if (task.status !== 'OPEN') throw new Error('Only an open task can be cancelled')
  return { ...task, status: 'CANCELLED', completedAt: undefined }
}
