import type { CommercialActivity, Customer, Order, Opportunity, Payment, PaymentProof } from '../../src/domain/index.js'
import type { LiveDocument } from './live.js'

export interface PaymentReview { proof: PaymentProof; order: Order; payment: Payment }
export interface CommandCenterCandidate { type: string; sourceId: string; summary: string; href: string }
export interface CommandCenterConversation {
  id: string
  tenantId: string
  contact: string
  maskedPhone: string
  requiresHuman: boolean
  unreadCount: number
  mode: string
  status: string
  lastActivityAt: string
  timeline: Array<{ id: string; direction: string; senderType: string; text: string; createdAt: string; status: string }>
  order: { id: string; status: string; fulfillmentStatus: string; paymentStatus: string; customerId: string; createdAt: string; updatedAt: string } | null
  payment: { status: string; proofId: string; paymentId: string } | null
  selection: { model: string; color: string; size: string } | null
  opportunity: { id: string; status: string; intent: string } | null
  alerts: string[]
  orderPath: string
  outbound: { status: string; attempts: number } | null
}
export function operationalAlertId(tenantId: string, type: string, sourceId: string): string
export function paginateCommandCenterConversations<T extends { id: string; lastActivityAt: string }>(snapshot: { conversations: T[]; [key: string]: unknown }, cursor: unknown): { conversations: T[]; nextCursor?: string; [key: string]: unknown }
export function buildNotificationsReadModel(documents: LiveDocument[], tenantIds: string[]): { alerts: Array<{ id: string; tenantId: string; type: string; summary: string; href: string; read: boolean; createdAt: string }>; unreadAlertCount: number }
export function buildCommandCenterReadModel(input: {
  documents: LiveDocument[]
  orders: Order[]
  customers: Customer[]
  reviews: PaymentReview[]
  activities?: CommercialActivity[]
  opportunities?: Opportunity[]
  tenantId: string
}): { conversations: CommandCenterConversation[]; candidates: CommandCenterCandidate[] }
