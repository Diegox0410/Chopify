import { FirestoreCommerceStateStore } from '../../src/infrastructure/firestoreCommerceStateStore.js'
import { isKnownTenant } from '../../src/config/tenantRegistry.js'
import type { CommerceStateStore } from '../../src/application/commerceRuntime.js'

export async function readConversationCommerceContext(
  input: { tenantId: string; customerId?: string; channel?: string; externalId?: string; conversationId?: string; timelineBefore?: {at:string;id:string}; timelineLimit?: number },
  store: Pick<CommerceStateStore, 'load'> = new FirestoreCommerceStateStore(),
) {
  if (!isKnownTenant(input.tenantId)) throw new Error('Tenant not allowed')
  // Loading directly never invokes the runtime's legacy migration/seed writes.
  const record = await store.load(input.tenantId)
  if (!record) return { customer: null, identities: [], orders: [], payments: [], activities: [], notes: [], opportunities: [], escalations: [], productInterests: [], proofLinks: [], productLookup: {}, timelineActivities: [] }
  const { commercial, orders } = record.state
  const identities = commercial.identities.filter(item => item.tenantId === input.tenantId)
  const identity = input.externalId && input.channel
    ? identities.find(item => item.channel === input.channel && item.externalIdentifier === input.externalId)
    : undefined
  const customerId = input.customerId || identity?.customerId
  const customer = customerId ? commercial.customers.find(item => item.tenantId === input.tenantId && item.id === customerId) : undefined
  if (!customer) return { customer: null, identities: [], orders: [], payments: [], activities: [], notes: [], opportunities: [], escalations: [], productInterests: [] }
  if (input.externalId && identity?.customerId !== customer.id) throw new Error('Customer channel identity does not match')
  const linkedOrders = orders.orders.filter(item => item.tenantId === input.tenantId && item.customerId === customer.id)
  const orderIds = new Set(linkedOrders.map(item => item.id))
  const opportunities = commercial.opportunities.filter(item => item.tenantId === input.tenantId && item.customerId === customer.id)
  const customerIdentities = identities.filter(item => item.customerId === customer.id)
  const linkedConversationIds = new Set(commercial.conversations.filter(item => item.tenantId === input.tenantId && item.customerId === customer.id).map(item => item.id))
  if (input.conversationId) linkedConversationIds.add(input.conversationId)
  const activities = commercial.activities.filter(item => item.tenantId === input.tenantId && (item.customerId === customer.id || Boolean(item.conversationId && linkedConversationIds.has(item.conversationId))))
  const audit = orders.audit.filter(item => item.tenantId === input.tenantId && (item.entityType === 'ORDER' && orderIds.has(item.entityId) || typeof item.metadata?.orderId === 'string' && orderIds.has(item.metadata.orderId)))
  const threadOrderIds = new Set(linkedOrders.filter(item => item.conversationId === input.conversationId).map(item => item.id))
  const timelineActivities = [...activities.filter(item => item.conversationId === input.conversationId || Boolean(item.orderId && threadOrderIds.has(item.orderId)))
    .map(item => ({ id: 'crm_activity_' + item.id, sourceId: item.id, type: item.type, text: item.summary || item.type, createdAt: item.occurredAt, actorType: item.actorType, orderId: item.orderId, conversationId: item.conversationId })),
    ...audit.filter(item => threadOrderIds.has(item.entityType === 'ORDER' ? item.entityId : String(item.metadata?.orderId || '')))
      .map(item => ({ id: 'crm_audit_' + item.id, sourceId: item.id, type: item.type, text: item.type, createdAt: item.timestamp, actorType: item.actorType, orderId: item.entityType === 'ORDER' ? item.entityId : String(item.metadata?.orderId || '') }))]
    .filter(item => !input.timelineBefore || item.createdAt < input.timelineBefore.at || item.createdAt === input.timelineBefore.at && item.id < input.timelineBefore.id)
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, Math.min(Math.max(input.timelineLimit || 31, 1), 51))
  return {
    customer, identities: customerIdentities, timelineActivities,
    orders: linkedOrders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
    proofLinks: orders.proofs.filter(item => item.tenantId === input.tenantId && orderIds.has(item.orderId)).map(item => ({ id: item.id, orderId: item.orderId, fileReference: item.assetReference || item.reference, status: item.status, submittedAt: item.submittedAt })),
    productLookup: Object.fromEntries(orders.products.filter(item => item.tenantId === input.tenantId).map(item => [item.id,item.name])),
    payments: orders.payments.filter(item => item.tenantId === input.tenantId && orderIds.has(item.orderId)).slice(-50),
    activities: [...activities.map(item => ({ id: item.id, type: item.type, summary: item.summary, occurredAt: item.occurredAt, actorType: item.actorType, orderId: item.orderId })),
      ...audit.map(item => ({ id: item.id, type: item.type, summary: undefined, occurredAt: item.timestamp, actorType: item.actorType, orderId: item.entityType === 'ORDER' ? item.entityId : item.metadata?.orderId }))]
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).slice(-100),
    notes: commercial.notes.filter(item => item.tenantId === input.tenantId && item.customerId === customer.id).slice(-50),
    opportunities: opportunities.slice(-50),
    escalations: commercial.escalations.filter(item => item.tenantId === input.tenantId && (item.customerId === customer.id || linkedConversationIds.has(item.conversationId))).slice(-50).map(item => ({
      id: item.id, conversationId: item.conversationId, orderId: item.orderId, reason: item.reason, status: item.status, createdAt: item.createdAt, resolvedAt: item.resolvedAt, resolution: 'resolution' in item ? item.resolution : undefined, resolvedBy: 'resolvedBy' in item ? item.resolvedBy : undefined,
    })),
    productInterests: [...new Set(linkedOrders.flatMap(item => item.items.map(line => line.productName)))],
  }
}
