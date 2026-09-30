import type { Customer, HumanEscalation, Opportunity, OpportunityLossReason, Order, PaymentProof } from '../domain/index.js'

export interface ProductSummary { id: string; name: string; priceCents: number; currency: string }
export interface ProductDetail extends ProductSummary { description?: string }
export interface ProductAvailability { productId: string; available: boolean; quantity?: number }
export interface CartRequest { tenantId: string; customerId: string; items: readonly { productId: string; quantity: number }[] }

export interface CommerceToolsPort {
  searchProducts(tenantId: string, query: string): Promise<readonly ProductSummary[]>
  getProduct(tenantId: string, productId: string): Promise<ProductDetail | null>
  getAvailability(tenantId: string, productId: string): Promise<ProductAvailability>
  getCustomer(tenantId: string, customerId: string): Promise<Customer | null>
  createCustomer(input: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Customer>
  createOpportunity(input: Omit<Opportunity, 'id' | 'createdAt' | 'updatedAt'>): Promise<Opportunity>
  qualifyOpportunity(tenantId: string, opportunityId: string): Promise<Opportunity>
  startOpportunityCart(tenantId: string, opportunityId: string): Promise<Opportunity>
  markOpportunityOrderCreated(tenantId: string, opportunityId: string): Promise<Opportunity>
  winOpportunity(tenantId: string, opportunityId: string): Promise<Opportunity>
  loseOpportunity(tenantId: string, opportunityId: string, reason: OpportunityLossReason, detail?: string): Promise<Opportunity>
  abandonOpportunity(tenantId: string, opportunityId: string, reason?: string): Promise<Opportunity>
  reopenOpportunity(tenantId: string, opportunityId: string): Promise<Opportunity>
  createCartRequest(input: CartRequest): Promise<{ requestId: string }>
  createOrder(input: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<Order>
  getOrder(tenantId: string, orderId: string): Promise<Order | null>
  submitPaymentProof(input: Omit<PaymentProof, 'id' | 'status' | 'submittedAt'>): Promise<PaymentProof>
  getOrderStatus(tenantId: string, orderId: string): Promise<Pick<Order, 'orderStatus' | 'paymentStatus' | 'fulfillmentStatus'> | null>
  requestHumanEscalation(input: Omit<HumanEscalation, 'id' | 'status' | 'createdAt'>): Promise<HumanEscalation>
}
