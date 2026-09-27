import type { CommercialTask, HumanEscalation, Opportunity, OpportunityStatus, Conversation, PaymentProof } from './index'

export const OPEN_PIPELINE_STATUSES: readonly OpportunityStatus[] = ['OPEN', 'QUALIFIED', 'CART_STARTED', 'ORDER_CREATED']
export const OPERATIONAL_PIPELINE_STATUSES = OPEN_PIPELINE_STATUSES

export interface PipelineProjection {
  countByStatus: Record<OpportunityStatus, number>
  estimatedValueByStatus: Record<OpportunityStatus, number>
  totalOpenPipelineValue: number
  wonCount: number
  lostCount: number
  abandonedCount: number
}

const statuses: readonly OpportunityStatus[] = ['OPEN', 'QUALIFIED', 'CART_STARTED', 'ORDER_CREATED', 'WON', 'LOST', 'ABANDONED']
export function projectPipeline(items: readonly Opportunity[]): PipelineProjection {
  const countByStatus = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<OpportunityStatus, number>
  const estimatedValueByStatus = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<OpportunityStatus, number>
  for (const item of items) {
    countByStatus[item.status] += 1
    estimatedValueByStatus[item.status] += item.estimatedValueCents
  }
  return {
    countByStatus,
    estimatedValueByStatus,
    totalOpenPipelineValue: OPEN_PIPELINE_STATUSES.reduce((sum, status) => sum + estimatedValueByStatus[status], 0),
    wonCount: countByStatus.WON,
    lostCount: countByStatus.LOST,
    abandonedCount: countByStatus.ABANDONED,
  }
}

export interface ConversionMetrics {
  totalOpportunities: number
  qualifiedOrLater: number
  orderCreatedOrLater: number
  won: number
  lost: number
  abandoned: number
  open: number
  closedOpportunities: number
  qualificationRate: number
  orderCreationRate: number
  winRate: number
}

export function calculateConversionMetrics(items: readonly Opportunity[]): ConversionMetrics {
  const total = items.length
  const qualifiedOrLater = items.filter((item) => ['QUALIFIED', 'CART_STARTED', 'ORDER_CREATED', 'WON'].includes(item.status)).length
  const orderCreatedOrLater = items.filter((item) => ['ORDER_CREATED', 'WON'].includes(item.status)).length
  const won = items.filter((item) => item.status === 'WON').length
  const lost = items.filter((item) => item.status === 'LOST').length
  const abandoned = items.filter((item) => item.status === 'ABANDONED').length
  const open = items.filter((item) => OPEN_PIPELINE_STATUSES.includes(item.status)).length
  const closedOpportunities = won + lost
  return {
    totalOpportunities: total, qualifiedOrLater, orderCreatedOrLater, won, lost, abandoned, open, closedOpportunities,
    qualificationRate: total ? qualifiedOrLater / total : 0,
    orderCreationRate: total ? orderCreatedOrLater / total : 0,
    winRate: closedOpportunities ? won / closedOpportunities : 0,
  }
}

export type AttentionSourceType = 'HUMAN_ESCALATION' | 'CONVERSATION' | 'COMMERCIAL_TASK' | 'PAYMENT_PROOF' | 'INVENTORY_CONFLICT'
export interface AttentionItem {
  tenantId: string
  sourceType: AttentionSourceType
  sourceId: string
  priority: 'NORMAL' | 'HIGH' | 'URGENT'
  label: string
  timestamp: string
  dueAt?: string
}

export function projectAttention(escalations: readonly HumanEscalation[], conversations: readonly Conversation[], tasks: readonly CommercialTask[], now: string, orderAttention: { proofs?: readonly PaymentProof[]; inventoryConflicts?: readonly { tenantId: string; id: string; label: string; occurredAt: string }[] } = {}): AttentionItem[] {
  const items: AttentionItem[] = [
    ...escalations.filter((item) => item.status !== 'RESOLVED').map((item): AttentionItem => ({ tenantId: item.tenantId, sourceType: 'HUMAN_ESCALATION', sourceId: item.id, priority: item.priority === 'LOW' ? 'NORMAL' : item.priority, label: item.contextSummary || item.reason, timestamp: item.createdAt })),
    ...conversations.filter((item) => item.status === 'HUMAN_REQUIRED').map((item): AttentionItem => ({ tenantId: item.tenantId, sourceType: 'CONVERSATION', sourceId: item.id, priority: 'HIGH', label: 'Conversación requiere atención humana', timestamp: item.lastActivityAt })),
    ...tasks.filter((item) => item.status === 'OPEN' && (item.priority === 'HIGH' || item.priority === 'URGENT')).map((item): AttentionItem => ({ tenantId: item.tenantId, sourceType: 'COMMERCIAL_TASK', sourceId: item.id, priority: item.dueAt && item.dueAt < now ? 'URGENT' : item.priority === 'URGENT' ? 'URGENT' : 'HIGH', label: item.title, timestamp: item.createdAt, dueAt: item.dueAt })),
    ...(orderAttention.proofs ?? []).filter((item) => ['RECEIVED', 'UNDER_REVIEW'].includes(item.status)).map((item): AttentionItem => ({ tenantId: item.tenantId, sourceType: 'PAYMENT_PROOF', sourceId: item.id, priority: 'HIGH', label: 'Comprobante pendiente de verificación', timestamp: item.submittedAt })),
    ...(orderAttention.inventoryConflicts ?? []).map((item): AttentionItem => ({ tenantId: item.tenantId, sourceType: 'INVENTORY_CONFLICT', sourceId: item.id, priority: 'URGENT', label: item.label, timestamp: item.occurredAt })),
  ]
  return items.sort((a, b) => (a.dueAt || a.timestamp).localeCompare(b.dueAt || b.timestamp))
}
