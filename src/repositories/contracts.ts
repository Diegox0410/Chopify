import type { AuditEvent, CommercialAgreement, Conversation, Customer, HumanEscalation, ManagedSale, Opportunity, Order, Settlement, Tenant } from '../domain'

export interface TenantRepository { list(): Promise<readonly Tenant[]>; getById(id: string): Promise<Tenant | null> }
export interface CustomerRepository { getById(tenantId: string, id: string): Promise<Customer | null>; save(customer: Customer): Promise<void> }
export interface ConversationRepository { getById(tenantId: string, id: string): Promise<Conversation | null>; save(conversation: Conversation): Promise<void> }
export interface OpportunityRepository { list(tenantId: string): Promise<readonly Opportunity[]>; getById(tenantId: string, id: string): Promise<Opportunity | null>; save(opportunity: Opportunity): Promise<void> }
export interface OrderRepository { list(tenantId: string): Promise<readonly Order[]>; getById(tenantId: string, id: string): Promise<Order | null>; save(order: Order): Promise<void> }
export interface AgreementRepository { getEffective(tenantId: string, at: string): Promise<CommercialAgreement | null> }
export interface ManagedSaleRepository { list(tenantId: string): Promise<readonly ManagedSale[]>; save(sale: ManagedSale): Promise<void> }
export interface EscalationRepository { listOpen(tenantId?: string): Promise<readonly HumanEscalation[]>; save(escalation: HumanEscalation): Promise<void> }
export interface SettlementRepository { list(tenantId: string): Promise<readonly Settlement[]>; save(settlement: Settlement): Promise<void> }
export interface AuditRepository { append(event: AuditEvent): Promise<void> }
