import type {
  Conversation,
  HumanEscalation,
  Order,
  PaymentProof,
} from './index'

export type SupervisorState =
  | 'BOT_RESOLVED'
  | 'SALE_IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'PAYMENT_PENDING'
  | 'HUMAN_REQUIRED'
  | 'COMPLAINT'
  | 'NO_INTEREST'
  | 'SALE_CLOSED'

export interface SupervisorCase {
  tenantId: string
  conversationId: string
  customerId: string
  state: SupervisorState
  needsHuman: boolean
  priority: HumanEscalation['priority']
  reason?: HumanEscalation['reason']
  escalationId?: string
  orderId?: string
  summary: string
}

export interface SupervisorSnapshot {
  tenantId: string
  cases: readonly SupervisorCase[]
  humanQueue: readonly SupervisorCase[]
  counts: Readonly<Record<SupervisorState, number>>
}

const emptyCounts = (): Record<SupervisorState, number> => ({
  BOT_RESOLVED: 0,
  SALE_IN_PROGRESS: 0,
  WAITING_CUSTOMER: 0,
  PAYMENT_PENDING: 0,
  HUMAN_REQUIRED: 0,
  COMPLAINT: 0,
  NO_INTEREST: 0,
  SALE_CLOSED: 0,
})

export function classifySupervisorCase(input: {
  conversation: Conversation
  escalation?: HumanEscalation
  order?: Order
  proof?: PaymentProof
}): SupervisorCase {
  const {
    conversation,
    escalation,
    order,
    proof,
  } = input

  const base = {
    tenantId: conversation.tenantId,
    conversationId: conversation.id,
    customerId: conversation.customerId,
    orderId: order?.id,
    escalationId: escalation?.id,
  }

  if (escalation?.reason === 'COMPLAINT') {
    return {
      ...base,
      state: 'COMPLAINT',
      needsHuman: true,
      priority: escalation.priority,
      reason: escalation.reason,
      summary: 'Reclamo requiere atención humana',
    }
  }

  if (escalation) {
    return {
      ...base,
      state: 'HUMAN_REQUIRED',
      needsHuman: true,
      priority: escalation.priority,
      reason: escalation.reason,
      summary: 'Excepción escalada a atención humana',
    }
  }

  if (conversation.status === 'HUMAN_REQUIRED') {
    return {
      ...base,
      state: 'HUMAN_REQUIRED',
      needsHuman: true,
      priority: 'NORMAL',
      summary: 'Conversación marcada para atención humana',
    }
  }

  if (
    order?.paymentStatus === 'PROOF_RECEIVED' ||
    order?.paymentStatus === 'UNDER_REVIEW' ||
    proof?.status === 'RECEIVED' ||
    proof?.status === 'UNDER_REVIEW'
  ) {
    return {
      ...base,
      state: 'PAYMENT_PENDING',
      needsHuman: true,
      priority: 'HIGH',
      reason: 'PAYMENT_ISSUE',
      summary: 'Comprobante pendiente de revisión humana',
    }
  }

  if (
    order?.paymentStatus === 'PAID' &&
    order.fulfillmentStatus === 'DELIVERED'
  ) {
    return {
      ...base,
      state: 'SALE_CLOSED',
      needsHuman: false,
      priority: 'LOW',
      summary: 'Venta pagada y entregada',
    }
  }

  if (order) {
    return {
      ...base,
      state: 'SALE_IN_PROGRESS',
      needsHuman: false,
      priority: 'NORMAL',
      summary: 'Venta en progreso',
    }
  }

  if (conversation.status === 'CLOSED') {
    return {
      ...base,
      state: 'BOT_RESOLVED',
      needsHuman: false,
      priority: 'LOW',
      summary: 'Conversación cerrada sin excepción abierta',
    }
  }

  if (conversation.status === 'AUTOMATED') {
    return {
      ...base,
      state: 'WAITING_CUSTOMER',
      needsHuman: false,
      priority: 'LOW',
      summary: 'Automatización activa; esperando siguiente interacción',
    }
  }

  return {
    ...base,
    state: 'SALE_IN_PROGRESS',
    needsHuman: false,
    priority: 'NORMAL',
    summary: 'Conversación comercial activa',
  }
}

export function supervisorCounts(
  cases: readonly SupervisorCase[],
) {
  const counts = emptyCounts()

  for (const item of cases) {
    counts[item.state] += 1
  }

  return counts
}