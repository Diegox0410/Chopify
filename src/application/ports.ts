import type { Customer, HumanEscalation, Opportunity, OpportunityStatus, Order, PaymentProof } from '../domain'

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
  updateOpportunity(tenantId: string, opportunityId: string, status: OpportunityStatus): Promise<Opportunity>
  createCartRequest(input: CartRequest): Promise<{ requestId: string }>
  createOrder(input: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<Order>
  getOrder(tenantId: string, orderId: string): Promise<Order | null>
  submitPaymentProof(input: Omit<PaymentProof, 'id' | 'status' | 'submittedAt'>): Promise<PaymentProof>
  getOrderStatus(tenantId: string, orderId: string): Promise<Pick<Order, 'orderStatus' | 'paymentStatus' | 'fulfillmentStatus'> | null>
  requestHumanEscalation(input: Omit<HumanEscalation, 'id' | 'status' | 'createdAt'>): Promise<HumanEscalation>
}
