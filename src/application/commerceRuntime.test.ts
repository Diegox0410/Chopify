import { describe,expect,it } from 'vitest'
import { MemoryCommerceStateStore,PersistentCommerceRuntime } from './commerceRuntime.js'
const req=(operation:Parameters<PersistentCommerceRuntime['execute']>[0]['operation'],input:Record<string,unknown>,id='r1')=>({operation,tenantId:'tenant-floes',input,requestId:id,correlationId:`c-${id}`,idempotencyKey:`idem-${id}`})
describe('Persistent Commerce Runtime H4-H6',()=>{
 it('persists customer and opportunity across runtime instances',async()=>{const store=new MemoryCommerceStateStore();const first=new PersistentCommerceRuntime(store);const customer=await first.execute(req('createOrUpdateCustomer',{name:'Cliente persistente',phone:'0990000000'},'customer')) as {customerId:string};const second=new PersistentCommerceRuntime(store);const opportunity=await second.execute(req('createOpportunity',{customerId:customer.customerId,title:'Venta persistente',source:'WEB'},'opp')) as {customerId:string};expect(opportunity.customerId).toBe(customer.customerId)})
 it('persists order status and keeps payment unapproved',async()=>{const store=new MemoryCommerceStateStore();const runtime=new PersistentCommerceRuntime(store);const customer=await runtime.execute(req('createOrUpdateCustomer',{name:'Comprador H4'},'c1')) as {customerId:string};const order=await runtime.execute(req('createOrderDraft',{customerId:customer.customerId,lines:[{productId:'fl-mto-1',quantity:1}]},'o1')) as {orderId:string};const restarted=new PersistentCommerceRuntime(store);const status=await restarted.execute(req('getOrderStatus',{orderId:order.orderId},'s1')) as {orderId:string;paymentStatus:string};expect(status.orderId).toBe(order.orderId);expect(status.paymentStatus).toBe('unpaid')})
 it('isolates persisted state by tenant',async()=>{const store=new MemoryCommerceStateStore();const floes=new PersistentCommerceRuntime(store);const customer=await floes.execute(req('createOrUpdateCustomer',{name:'Solo FLOES'},'iso')) as {customerId:string};const mg=new PersistentCommerceRuntime(store);await expect(mg.execute({operation:'createOpportunity',tenantId:'tenant-mg',input:{customerId:customer.customerId,title:'No permitido'},requestId:'x',correlationId:'x',idempotencyKey:'x'})).rejects.toThrow('Customer not found in tenant')})
 it('persists H6 identity resolution across runtime instances',async()=>{const store=new MemoryCommerceStateStore();const first=new PersistentCommerceRuntime(store);const initial=await first.execute(req('resolveCustomerIdentity',{channel:'INSTAGRAM',externalIdentifier:'@cliente-h6',name:'Cliente H6'},'h6-1')) as {customerId:string;identityId:string;createdIdentity:boolean};expect(initial.createdIdentity).toBe(true);const second=new PersistentCommerceRuntime(store);const repeated=await second.execute(req('resolveCustomerIdentity',{channel:'INSTAGRAM',externalIdentifier:'@CLIENTE-H6'},'h6-2')) as {customerId:string;identityId:string;createdCustomer:boolean;createdIdentity:boolean};expect(repeated.customerId).toBe(initial.customerId);expect(repeated.identityId).toBe(initial.identityId);expect(repeated.createdCustomer).toBe(false);expect(repeated.createdIdentity).toBe(false)})
 it('persists the complete human-reviewed sale lifecycle and inventory commitment',async()=>{
  const store=new MemoryCommerceStateStore();const runtime=new PersistentCommerceRuntime(store)
  const customer=await runtime.execute(req('createOrUpdateCustomer',{name:'Cliente E2E FLOES',phone:'+573001112233'},'sale-customer')) as {customerId:string}
  const opportunity=await runtime.execute(req('createOpportunity',{customerId:customer.customerId,title:'Venta FLOES E2E',productIds:['fl-hybrid-1']},'sale-opportunity')) as {opportunityId:string}
  const before=await runtime.execute(req('checkAvailability',{productId:'fl-hybrid-1',quantity:1},'sale-stock-before')) as {availableQuantity:number}
  const orderInput={customerId:customer.customerId,opportunityId:opportunity.opportunityId,lines:[{productId:'fl-hybrid-1',quantity:1}]}
  const order=await runtime.execute(req('createOrderDraft',orderInput,'sale-order')) as {orderId:string}
  const repeated=await runtime.execute(req('createOrderDraft',orderInput,'sale-order')) as {orderId:string}
  expect(repeated.orderId).toBe(order.orderId)
  const proof=await runtime.execute(req('attachPaymentProof',{orderId:order.orderId,proofUrl:'https://files.example.test/floes-e2e'},'sale-proof')) as {proofId:string;paymentId:string;status:string}
  expect(proof.status).toBe('pending_review')
  await runtime.execute(req('approvePayment',{paymentId:proof.paymentId,proofId:proof.proofId},'sale-approval'))
  await runtime.execute(req('startPreparation',{orderId:order.orderId},'sale-preparing'))
  await runtime.execute(req('markReady',{orderId:order.orderId},'sale-ready'))
  await runtime.execute(req('dispatchOrder',{orderId:order.orderId,courier:'Courier E2E',trackingCode:'TRACK-E2E'},'sale-dispatch'))
  const delivered=await runtime.execute(req('markDelivered',{orderId:order.orderId},'sale-delivered')) as {status:string;paymentStatus:string;fulfillmentStatus:string}
  const after=await runtime.execute(req('checkAvailability',{productId:'fl-hybrid-1',quantity:1},'sale-stock-after')) as {availableQuantity:number}
  expect(delivered).toMatchObject({status:'delivered',paymentStatus:'approved',fulfillmentStatus:'delivered'})
  expect(after.availableQuantity).toBe(before.availableQuantity-1)
 })
 it('persists explicit payment-proof rejection without approving the order',async()=>{
  const store=new MemoryCommerceStateStore();const runtime=new PersistentCommerceRuntime(store)
  const order=await runtime.execute(req('createOrderDraft',{customerId:'cus-fl-1',lines:[{productId:'fl-mto-1',quantity:1}]},'reject-order')) as {orderId:string}
  const proof=await runtime.execute(req('attachPaymentProof',{orderId:order.orderId,proofUrl:'https://files.example.test/rejected'},'reject-proof')) as {proofId:string;paymentId:string}
  const rejected=await runtime.execute(req('rejectPaymentProof',{paymentId:proof.paymentId,proofId:proof.proofId,reason:'El valor no coincide'},'reject-review')) as {status:string}
  const status=await runtime.execute(req('getOrderStatus',{orderId:order.orderId},'reject-status')) as {paymentStatus:string}
  expect(rejected.status).toBe('rejected');expect(status.paymentStatus).toBe('rejected')
 })
})
