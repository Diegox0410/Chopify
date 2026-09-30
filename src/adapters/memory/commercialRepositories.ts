import type { CommercialActivity, CommercialNote, CommercialTask, Conversation, Customer, CustomerIdentity, HumanEscalation, Opportunity, Tenant } from '../../domain/index.js'
import type { CommercialActivityRepository, CommercialNoteRepository, CommercialTaskRepository, ConversationRepository, CustomerIdentityRepository, CustomerRepository, EscalationRepository, OpportunityRepository, TenantRepository } from '../../repositories/contracts.js'
import { sampleActivities, sampleConversations, sampleCustomers, sampleEscalations, sampleIdentities, sampleNotes, sampleOpportunities, sampleTasks, sampleTenants } from '../../data/sample/index.js'

export interface SampleDatabase {
  tenants: Tenant[]; customers: Customer[]; identities: CustomerIdentity[]; conversations: Conversation[]; opportunities: Opportunity[]
  activities: CommercialActivity[]; notes: CommercialNote[]; tasks: CommercialTask[]; escalations: HumanEscalation[]
}
export function createSampleDatabase(): SampleDatabase {
  return { tenants: [...sampleTenants], customers: [...sampleCustomers], identities: [...sampleIdentities], conversations: [...sampleConversations], opportunities: [...sampleOpportunities], activities: [...sampleActivities], notes: [...sampleNotes], tasks: [...sampleTasks], escalations: [...sampleEscalations] }
}
const assertTenant = (tenantId: string, entity: { tenantId: string }) => { if (entity.tenantId !== tenantId) throw new Error('Cross-tenant mutation rejected') }
const upsert = <T extends { id: string }>(items: T[], entity: T) => { const index = items.findIndex((item) => item.id === entity.id); if (index >= 0) items[index] = entity; else items.push(entity) }

export class MemoryTenantRepository implements TenantRepository {
  constructor(private readonly db: SampleDatabase) {}
  async list() { return [...this.db.tenants] }
  async getById(id: string) { return this.db.tenants.find((item) => item.id === id) ?? null }
}
export class MemoryCustomerRepository implements CustomerRepository {
  constructor(private readonly db: SampleDatabase) {}
  async listByTenant(tenantId: string, filters: Parameters<CustomerRepository['listByTenant']>[1] = {}) { const query = filters?.search?.trim().toLocaleLowerCase(); return this.db.customers.filter((item) => item.tenantId === tenantId && (!filters?.status || item.status === filters.status) && (!query || [item.name, item.email, item.phone].some((value) => value?.toLocaleLowerCase().includes(query)))) }
  async getById(tenantId: string, id: string) { return this.db.customers.find((item) => item.tenantId === tenantId && item.id === id) ?? null }
  async save(tenantId: string, item: Customer) { assertTenant(tenantId, item); upsert(this.db.customers, item) }
}
export class MemoryCustomerIdentityRepository implements CustomerIdentityRepository {
  constructor(private readonly db: SampleDatabase) {}
  async listByCustomer(tenantId: string, customerId: string) { return this.db.identities.filter((item) => item.tenantId === tenantId && item.customerId === customerId) }
  async resolve(tenantId: string, channel: CustomerIdentity['channel'], externalIdentifier: string) { return this.db.identities.find((item) => item.tenantId === tenantId && item.channel === channel && item.externalIdentifier === externalIdentifier) ?? null }
  async save(tenantId: string, item: CustomerIdentity) { assertTenant(tenantId, item); const duplicate = await this.resolve(tenantId, item.channel, item.externalIdentifier); if (duplicate && duplicate.id !== item.id) throw new Error('Identity already exists in this tenant'); upsert(this.db.identities, item) }
}
export class MemoryConversationRepository implements ConversationRepository {
  constructor(private readonly db: SampleDatabase) {}
  async listByTenant(tenantId: string, filters: Parameters<ConversationRepository['listByTenant']>[1] = {}) { return this.db.conversations.filter((item) => item.tenantId === tenantId && (!filters?.status || item.status === filters.status) && (!filters?.channel || item.channel === filters.channel) && (!filters?.humanRequired || item.status === 'HUMAN_REQUIRED')) }
  async getById(tenantId: string, id: string) { return this.db.conversations.find((item) => item.tenantId === tenantId && item.id === id) ?? null }
  async save(tenantId: string, item: Conversation) { assertTenant(tenantId, item); upsert(this.db.conversations, item) }
}
export class MemoryOpportunityRepository implements OpportunityRepository {
  constructor(private readonly db: SampleDatabase) {}
  async listByTenant(tenantId: string, filters: Parameters<OpportunityRepository['listByTenant']>[1] = {}) { return this.db.opportunities.filter((item) => item.tenantId === tenantId && (!filters?.status || item.status === filters.status) && (!filters?.customerId || item.customerId === filters.customerId)) }
  async getById(tenantId: string, id: string) { return this.db.opportunities.find((item) => item.tenantId === tenantId && item.id === id) ?? null }
  async save(tenantId: string, item: Opportunity) { assertTenant(tenantId, item); upsert(this.db.opportunities, item) }
}
export class MemoryActivityRepository implements CommercialActivityRepository {
  constructor(private readonly db: SampleDatabase) {}
  async listByTenant(tenantId: string, filters: Parameters<CommercialActivityRepository['listByTenant']>[1] = {}) { return this.db.activities.filter((item) => item.tenantId === tenantId && (!filters?.customerId || item.customerId === filters.customerId) && (!filters?.opportunityId || item.opportunityId === filters.opportunityId) && (!filters?.conversationId || item.conversationId === filters.conversationId) && (!filters?.orderId || item.orderId === filters.orderId) && (!filters?.paymentId || item.paymentId === filters.paymentId)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) }
  async append(tenantId: string, item: CommercialActivity) { assertTenant(tenantId, item); this.db.activities.push(item) }
}
export class MemoryNoteRepository implements CommercialNoteRepository {
  constructor(private readonly db: SampleDatabase) {}
  async listByCustomer(tenantId: string, customerId: string) { return this.db.notes.filter((item) => item.tenantId === tenantId && item.customerId === customerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  async save(tenantId: string, item: CommercialNote) { assertTenant(tenantId, item); upsert(this.db.notes, item) }
}
export class MemoryTaskRepository implements CommercialTaskRepository {
  constructor(private readonly db: SampleDatabase) {}
  async listByTenant(tenantId: string, filters: Parameters<CommercialTaskRepository['listByTenant']>[1] = {}) { return this.db.tasks.filter((item) => item.tenantId === tenantId && (!filters?.customerId || item.customerId === filters.customerId) && (!filters?.status || item.status === filters.status)) }
  async getById(tenantId: string, id: string) { return this.db.tasks.find((item) => item.tenantId === tenantId && item.id === id) ?? null }
  async save(tenantId: string, item: CommercialTask) { assertTenant(tenantId, item); upsert(this.db.tasks, item) }
}
export class MemoryEscalationRepository implements EscalationRepository {
  constructor(private readonly db: SampleDatabase) {}
  async listOpen(tenantId: string) { return this.db.escalations.filter((item) => item.tenantId === tenantId && item.status !== 'RESOLVED') }
  async save(tenantId: string, item: HumanEscalation) { assertTenant(tenantId, item); upsert(this.db.escalations, item) }
}

export function createSampleRepositories(db = createSampleDatabase()) {
  return { db, tenants: new MemoryTenantRepository(db), customers: new MemoryCustomerRepository(db), identities: new MemoryCustomerIdentityRepository(db), conversations: new MemoryConversationRepository(db), opportunities: new MemoryOpportunityRepository(db), activities: new MemoryActivityRepository(db), notes: new MemoryNoteRepository(db), tasks: new MemoryTaskRepository(db), escalations: new MemoryEscalationRepository(db) }
}
