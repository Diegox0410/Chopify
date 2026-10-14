import { auth } from '../../auth/firebaseClient'

export interface LiveConversation {
  id: string; tenantId: string; customerId: string | null; channel: string; contact: string; maskedPhone: string
  origin: string | null; createdAt: string; lastActivityAt: string; status: string; mode: string; requiresHuman: boolean
  assignedTo: string | null; unreadCount: number; lastMessage: string; closeReason?: string; firstResponseAt?: string | null
}
export interface MessageEvent {
  id: string; conversationId: string; direction: 'INBOUND' | 'OUTBOUND' | 'EVENT'; senderType: 'CLIENT' | 'GANOBOT' | 'HUMAN' | 'SYSTEM'
  createdAt: string; text: string; status: string; deliveryStatus: string | null; correlationId?: string; technicalReason?: string
  attachments: Array<{ type: 'IMAGE' | 'PAYMENT_PROOF'; private: boolean; url?: string; caption?: string }>
  action?: string; actor?: string; reason?: string
}
export interface LiveCustomer { id: string; tenantId: string; name: string; phone?: string; email?: string; status: string; acquisitionSource?: string; identities?: Array<{ channel: string; externalIdentifier: string }> }
export interface CommerceContext {
  orders: Array<{ id: string; orderStatus: string; paymentStatus: string; fulfillmentStatus: string; currency: string; grandTotalCents: number; followUp?: {outcome:string;note?:string} }>
  payments: Array<{ id: string; orderId: string; status: string }>
  activities: Array<{ id: string; summary?: string; type?: string; occurredAt?: string; createdAt?: string }>
  notes: Array<{ id: string; body: string; createdAt: string }>
  opportunities: Array<{ id: string; status: string; intent: string }>; productInterests?: string[]
  escalations?: Array<{id:string;reason:string;status:string;resolution?:string;createdAt:string;updatedAt?:string}>
}
export interface ConversationList { ok: true; conversations: LiveConversation[]; nextCursor?: string; coverage?: string }
export interface ConversationThread { ok: true; conversation: LiveConversation; timeline: MessageEvent[]; customer: LiveCustomer | null; commerce: CommerceContext; nextCursor?: string }
export interface CustomerContext { ok: true; customer: LiveCustomer; conversations: LiveConversation[]; commerce: CommerceContext; nextCursor?: string }
export interface ConversationActionResult { ok: boolean; status: string; mode?: string; outboundId?: string; correlationId: string; deliveryStatus?: string | null; reason?: string }
export async function conversationRequest<T>(tenantId: string, params: Record<string, string | number | undefined>, body?: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new Error('Inicia sesión para consultar conversaciones.')
  const token = await user.getIdToken()
  const query = new URLSearchParams({ tenantId })
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value))
  const response = await fetch('/api/conversations?' + query, {
    method: body ? 'POST' : 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify({ ...body, tenantId }) } : {}),
  })
  const data = await response.json() as { ok?: boolean; error?: string }
  if (!response.ok) throw new Error(response.status === 401 ? 'Tu sesión expiró.' : response.status === 403 ? 'No tienes acceso a este negocio.' : data.error || 'No fue posible completar la operación.')
  return data as T
}
export const conversationDate = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-EC', {dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Sin fecha'
const statusLabels: Record<string, string> = { AI_ATTENDING: 'IA atendiendo', WAITING_CUSTOMER: 'Esperando cliente', WAITING_PAYMENT: 'Esperando pago', PAYMENT_REVIEW: 'Pago en revisión', REQUIRES_HUMAN: 'Requiere atención', HUMAN_ATTENDING: 'Humano atendiendo', PREPARING: 'En preparación', DISPATCHED: 'Enviado', DELIVERED: 'Entregado', POSTSALE: 'Postventa', CLOSED: 'Cerrado' }
export const conversationStatus = (status: string) => statusLabels[status] || status
