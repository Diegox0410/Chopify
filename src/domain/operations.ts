import type { EntityId, ISODateTime, TenantScoped } from './shared'

export type EscalationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type EscalationReason = 'CUSTOMER_REQUEST' | 'COMPLAINT' | 'PAYMENT_ISSUE' | 'PRICING_EXCEPTION' | 'STOCK_CONFLICT' | 'RETURN_REQUEST' | 'DELIVERY_ISSUE' | 'UNKNOWN_PRODUCT' | 'SYSTEM_ERROR' | 'OTHER'
export type EscalationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
export interface HumanEscalation extends TenantScoped {
  id: EntityId; customerId?: EntityId; conversationId: EntityId; orderId?: EntityId; reason: EscalationReason; priority: EscalationPriority; status: EscalationStatus; contextSummary?: string; assignedTo?: EntityId; createdAt: ISODateTime; resolvedAt?: ISODateTime
}
export function resolveEscalation(item: HumanEscalation, at: ISODateTime): HumanEscalation { return { ...item, status: 'RESOLVED', resolvedAt: at } }

export type ActorType = 'CUSTOMER' | 'TENANT_USER' | 'PLATFORM_USER' | 'AUTOMATION' | 'SYSTEM'
export interface AuditEvent extends TenantScoped { id: EntityId; entityType: string; entityId: EntityId; type: string; actorType: ActorType; actorId?: EntityId; timestamp: ISODateTime; metadata?: Readonly<Record<string, string | number | boolean | null>> }

export type WorkStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export interface SourceEntity { type: string; id: EntityId }
interface ScheduledWork extends TenantScoped { id: EntityId; customerId: EntityId; status: WorkStatus; dueAt: ISODateTime; source: SourceEntity; conversationId?: EntityId; orderId?: EntityId; createdAt: ISODateTime }
export interface FollowUp extends ScheduledWork { kind: 'FOLLOW_UP' }
export interface PostSaleTask extends ScheduledWork { kind: 'POST_SALE' }
export interface RepurchaseOpportunity extends ScheduledWork { kind: 'REPURCHASE' }

export type ContentPublicationStatus = 'DRAFT' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED'
export interface ContentPublication extends TenantScoped { id: EntityId; contentId: EntityId; channel: string; status: ContentPublicationStatus; feeCents: number; publishedAt?: ISODateTime; externalId?: string }
