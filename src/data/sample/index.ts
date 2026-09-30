import type { CommercialActivity, CommercialNote, CommercialTask, Conversation, Customer, CustomerIdentity, HumanEscalation, Opportunity, Tenant } from '../../domain/index.js'

const at = (day: number, hour = 14) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`
const createdAt = at(1, 9)

export const sampleTenants: readonly Tenant[] = [
  { id: 'tenant-mg', slug: 'mg', name: 'MG', status: 'ACTIVE', createdAt, updatedAt: at(20) },
  { id: 'tenant-dgng', slug: 'dgng', name: 'DGNG', status: 'ACTIVE', createdAt, updatedAt: at(20) },
  { id: 'tenant-floes', slug: 'floes', name: 'FLOES', status: 'ACTIVE', createdAt, updatedAt: at(20) },
]

export const sampleCustomers: readonly Customer[] = [
  { id: 'cus-mg-1', tenantId: 'tenant-mg', name: 'Laura Méndez', phone: '+57 300 555 0101', email: 'laura@example.test', status: 'ACTIVE', acquisitionSource: 'Referido', tags: ['recompra', 'bienestar'], createdAt, updatedAt: at(24), lastInteractionAt: at(24) },
  { id: 'cus-mg-2', tenantId: 'tenant-mg', name: 'Andrés Ríos', phone: '+57 300 555 0102', status: 'LEAD', acquisitionSource: 'Web', tags: ['nuevo'], createdAt: at(5), updatedAt: at(26), lastInteractionAt: at(26) },
  { id: 'cus-mg-3', tenantId: 'tenant-mg', name: 'Camila Torres', email: 'camila@example.test', status: 'ACTIVE', acquisitionSource: 'Instagram', tags: ['prioridad'], createdAt: at(8), updatedAt: at(25), lastInteractionAt: at(25) },
  { id: 'cus-mg-4', tenantId: 'tenant-mg', name: 'Mateo Silva', status: 'INACTIVE', acquisitionSource: 'Evento', createdAt: at(2), updatedAt: at(18), lastInteractionAt: at(18) },
  { id: 'cus-dg-1', tenantId: 'tenant-dgng', name: 'Valentina Cruz', phone: '+57 301 555 0201', status: 'ACTIVE', acquisitionSource: 'WhatsApp', tags: ['mayorista'], createdAt, updatedAt: at(25), lastInteractionAt: at(25) },
  { id: 'cus-dg-2', tenantId: 'tenant-dgng', name: 'Samuel Peña', email: 'samuel@example.test', status: 'LEAD', acquisitionSource: 'Web', createdAt: at(7), updatedAt: at(23), lastInteractionAt: at(23) },
  { id: 'cus-dg-3', tenantId: 'tenant-dgng', name: 'Mariana Gil', status: 'ARCHIVED', acquisitionSource: 'Facebook', createdAt: at(3), updatedAt: at(16), lastInteractionAt: at(16) },
  { id: 'cus-fl-1', tenantId: 'tenant-floes', name: 'Sofía León', phone: '+57 302 555 0301', status: 'ACTIVE', acquisitionSource: 'Instagram', tags: ['diseño'], createdAt, updatedAt: at(27), lastInteractionAt: at(27) },
  { id: 'cus-fl-2', tenantId: 'tenant-floes', name: 'Tomás Vidal', email: 'tomas@example.test', status: 'LEAD', acquisitionSource: 'Web', createdAt: at(10), updatedAt: at(24), lastInteractionAt: at(24) },
  { id: 'cus-fl-3', tenantId: 'tenant-floes', name: 'Elena Mora', status: 'ACTIVE', acquisitionSource: 'Referido', createdAt: at(4), updatedAt: at(22), lastInteractionAt: at(22) },
]

export const sampleIdentities: readonly CustomerIdentity[] = [
  { id: 'identity-mg-1', tenantId: 'tenant-mg', customerId: 'cus-mg-1', channel: 'WHATSAPP', externalIdentifier: '3005550101', createdAt },
  { id: 'identity-dg-1', tenantId: 'tenant-dgng', customerId: 'cus-dg-1', channel: 'WHATSAPP', externalIdentifier: '3005550101', createdAt },
  { id: 'identity-mg-2', tenantId: 'tenant-mg', customerId: 'cus-mg-2', channel: 'WEB', externalIdentifier: 'web-mg-002', createdAt },
  { id: 'identity-fl-1', tenantId: 'tenant-floes', customerId: 'cus-fl-1', channel: 'INSTAGRAM', externalIdentifier: 'sofia-demo', createdAt },
]

export const sampleConversations: readonly Conversation[] = [
  { id: 'conv-mg-1', tenantId: 'tenant-mg', customerId: 'cus-mg-1', channel: 'WHATSAPP', status: 'OPEN', assignedMode: 'HUMAN', assignedUserId: 'usr-ana', startedAt: at(20), lastActivityAt: at(24), createdAt: at(20), updatedAt: at(24) },
  { id: 'conv-mg-2', tenantId: 'tenant-mg', customerId: 'cus-mg-2', channel: 'WEB', status: 'HUMAN_REQUIRED', assignedMode: 'AUTOMATION', automationAgent: 'sample-triage', startedAt: at(25), lastActivityAt: at(26), createdAt: at(25), updatedAt: at(26) },
  { id: 'conv-mg-3', tenantId: 'tenant-mg', customerId: 'cus-mg-3', channel: 'INSTAGRAM', status: 'AUTOMATED', assignedMode: 'AUTOMATION', automationAgent: 'sample-triage', startedAt: at(24), lastActivityAt: at(25), createdAt: at(24), updatedAt: at(25) },
  { id: 'conv-dg-1', tenantId: 'tenant-dgng', customerId: 'cus-dg-1', channel: 'WHATSAPP', status: 'OPEN', assignedMode: 'HUMAN', assignedUserId: 'usr-nico', startedAt: at(23), lastActivityAt: at(25), createdAt: at(23), updatedAt: at(25) },
  { id: 'conv-dg-2', tenantId: 'tenant-dgng', customerId: 'cus-dg-2', channel: 'WEB', status: 'CLOSED', assignedMode: 'HUMAN', assignedUserId: 'usr-nico', startedAt: at(18), lastActivityAt: at(23), closedAt: at(23), createdAt: at(18), updatedAt: at(23) },
  { id: 'conv-fl-1', tenantId: 'tenant-floes', customerId: 'cus-fl-1', channel: 'INSTAGRAM', status: 'OPEN', assignedMode: 'HUMAN', assignedUserId: 'usr-lina', startedAt: at(25), lastActivityAt: at(27), createdAt: at(25), updatedAt: at(27) },
  { id: 'conv-fl-2', tenantId: 'tenant-floes', customerId: 'cus-fl-2', channel: 'WEB', status: 'AUTOMATED', assignedMode: 'AUTOMATION', automationAgent: 'sample-triage', startedAt: at(22), lastActivityAt: at(24), createdAt: at(22), updatedAt: at(24) },
  { id: 'conv-fl-3', tenantId: 'tenant-floes', customerId: 'cus-fl-3', channel: 'OTHER', status: 'CLOSED', assignedMode: 'HUMAN', assignedUserId: 'usr-lina', startedAt: at(15), lastActivityAt: at(22), closedAt: at(22), createdAt: at(15), updatedAt: at(22) },
]

const opportunity = (id: string, tenantId: string, customerId: string, status: Opportunity['status'], value: number, intent: Opportunity['intent'], day: number, conversationId?: string): Opportunity => ({ id, tenantId, customerId, conversationId, status, intent, estimatedValueCents: value, currency: 'COP', acquisitionSource: 'SAMPLE', conversionChannel: conversationId ? 'DIGITAL' : 'DIRECT', assignedTo: 'platform-owner', createdAt: at(day - 3), updatedAt: at(day), lastActivityAt: at(day), ...(status === 'WON' ? { wonAt: at(day) } : {}), ...(status === 'LOST' ? { lostAt: at(day), lostReason: 'PRICE' as const } : {}), ...(status === 'ABANDONED' ? { abandonedAt: at(day), abandonedReason: 'Sin respuesta' } : {}) })
export const sampleOpportunities: readonly Opportunity[] = [
  opportunity('opp-mg-1', 'tenant-mg', 'cus-mg-1', 'OPEN', 24000000, 'REPURCHASE', 24, 'conv-mg-1'), opportunity('opp-mg-2', 'tenant-mg', 'cus-mg-2', 'QUALIFIED', 39000000, 'PURCHASE_INTENT', 26, 'conv-mg-2'), opportunity('opp-mg-3', 'tenant-mg', 'cus-mg-3', 'CART_STARTED', 58000000, 'PRODUCT_DISCOVERY', 25, 'conv-mg-3'), opportunity('opp-mg-4', 'tenant-mg', 'cus-mg-1', 'WON', 31000000, 'PURCHASE_INTENT', 21), opportunity('opp-mg-5', 'tenant-mg', 'cus-mg-4', 'ABANDONED', 18000000, 'PRICE_CHECK', 18),
  opportunity('opp-dg-1', 'tenant-dgng', 'cus-dg-1', 'ORDER_CREATED', 125000000, 'PURCHASE_INTENT', 25, 'conv-dg-1'), opportunity('opp-dg-2', 'tenant-dgng', 'cus-dg-2', 'OPEN', 46000000, 'PRODUCT_QUESTION', 23, 'conv-dg-2'), opportunity('opp-dg-3', 'tenant-dgng', 'cus-dg-1', 'LOST', 72000000, 'AVAILABILITY_CHECK', 20), opportunity('opp-dg-4', 'tenant-dgng', 'cus-dg-2', 'WON', 88000000, 'PURCHASE_INTENT', 19),
  opportunity('opp-fl-1', 'tenant-floes', 'cus-fl-1', 'QUALIFIED', 94000000, 'PRODUCT_DISCOVERY', 27, 'conv-fl-1'), opportunity('opp-fl-2', 'tenant-floes', 'cus-fl-2', 'CART_STARTED', 63000000, 'PURCHASE_INTENT', 24, 'conv-fl-2'), opportunity('opp-fl-3', 'tenant-floes', 'cus-fl-3', 'OPEN', 27000000, 'GENERAL_QUESTION', 22, 'conv-fl-3'), opportunity('opp-fl-4', 'tenant-floes', 'cus-fl-1', 'ABANDONED', 51000000, 'PRICE_CHECK', 17),
]

export const sampleNotes: readonly CommercialNote[] = [
  { id: 'note-1', tenantId: 'tenant-mg', customerId: 'cus-mg-1', opportunityId: 'opp-mg-1', authorId: 'platform-owner', body: 'Prefiere seguimiento durante la tarde.', createdAt: at(23) },
  { id: 'note-2', tenantId: 'tenant-dgng', customerId: 'cus-dg-1', authorId: 'platform-owner', body: 'Solicitó revisar alternativas antes del cierre.', createdAt: at(24) },
  { id: 'note-3', tenantId: 'tenant-floes', customerId: 'cus-fl-1', opportunityId: 'opp-fl-1', authorId: 'platform-owner', body: 'Interés confirmado en la propuesta SAMPLE.', createdAt: at(26) },
]
export const sampleTasks: readonly CommercialTask[] = [
  { id: 'task-1', tenantId: 'tenant-mg', customerId: 'cus-mg-2', opportunityId: 'opp-mg-2', title: 'Contactar y aclarar alcance', status: 'OPEN', priority: 'URGENT', dueAt: at(26, 10), assignedTo: 'usr-ana', createdAt: at(25) },
  { id: 'task-2', tenantId: 'tenant-dgng', customerId: 'cus-dg-1', opportunityId: 'opp-dg-1', title: 'Validar condiciones comerciales', status: 'OPEN', priority: 'HIGH', dueAt: at(28), assignedTo: 'usr-nico', createdAt: at(24) },
  { id: 'task-3', tenantId: 'tenant-floes', customerId: 'cus-fl-1', title: 'Enviar resumen de propuesta', status: 'OPEN', priority: 'NORMAL', dueAt: at(29), assignedTo: 'usr-lina', createdAt: at(26) },
  { id: 'task-4', tenantId: 'tenant-mg', customerId: 'cus-mg-1', title: 'Registrar preferencias', status: 'COMPLETED', priority: 'LOW', createdAt: at(20), completedAt: at(21) },
]
export const sampleActivities: readonly CommercialActivity[] = [
  { id: 'act-1', tenantId: 'tenant-mg', customerId: 'cus-mg-1', opportunityId: 'opp-mg-1', type: 'OPPORTUNITY_CREATED', actorType: 'TENANT_USER', actorId: 'usr-ana', occurredAt: at(21), summary: 'Oportunidad SAMPLE creada' },
  { id: 'act-2', tenantId: 'tenant-mg', customerId: 'cus-mg-2', conversationId: 'conv-mg-2', type: 'CONVERSATION_ESCALATED', actorType: 'AUTOMATION', occurredAt: at(26), summary: 'Marcada para atención humana' },
  { id: 'act-3', tenantId: 'tenant-dgng', customerId: 'cus-dg-1', opportunityId: 'opp-dg-1', type: 'OPPORTUNITY_STAGE_CHANGED', actorType: 'TENANT_USER', actorId: 'usr-nico', occurredAt: at(25), summary: 'Etapa comercial: ORDER_CREATED' },
  { id: 'act-4', tenantId: 'tenant-floes', customerId: 'cus-fl-1', opportunityId: 'opp-fl-1', type: 'OPPORTUNITY_QUALIFIED', actorType: 'PLATFORM_USER', actorId: 'platform-owner', occurredAt: at(27), summary: 'Oportunidad calificada' },
]
export const sampleEscalations: readonly HumanEscalation[] = []
