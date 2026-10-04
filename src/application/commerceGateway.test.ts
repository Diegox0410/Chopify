import { beforeEach,describe,expect,it } from 'vitest'
import { createSampleRepositories } from '../adapters/memory/commercialRepositories.js'
import { createSampleOrderRepositories } from '../adapters/memory/orderRepositories.js'
import { CommercialApplication } from './commercial.js'
import { OrderApplication } from './orders.js'
import { CommerceGateway } from './commerceGateway.js'
import { SupervisorApplication } from './supervisor.js'
import { CustomerIdentityResolver } from './customerIdentityResolver.js'
let gateway:CommerceGateway
beforeEach(()=>{
 const c=createSampleRepositories();const o=createSampleOrderRepositories();const now=()=> '2026-09-28T18:00:00.000Z'
 const commercial=new CommercialApplication(c,now)
 const orders=new OrderApplication({tenants:c.tenants,customers:c.customers,opportunities:c.opportunities,activities:c.activities,...o},now)
 const supervisor=new SupervisorApplication({...c,orders:o.orders,proofs:o.proofs},now)
 const identityResolver=new CustomerIdentityResolver(c,now)
 gateway=new CommerceGateway(commercial,orders,o.commerce,supervisor,identityResolver)
})
describe('Commerce Gateway H3-H6',()=>{
 it('isolates catalog by tenant',async()=>{const floes=await gateway.execute({operation:'searchProducts',tenantId:'tenant-floes',input:{query:''}}) as Array<{productId:string}>;expect(floes).toHaveLength(4);expect(floes.every(i=>i.productId.startsWith('floes-'))).toBe(true)})
 it('creates order and keeps it unpaid',async()=>{const result=await gateway.execute({operation:'createOrderDraft',tenantId:'tenant-mg',input:{customerId:'cus-mg-1',lines:[{productId:'mg-stock-1',quantity:1}]},idempotencyKey:'h3-order-1'}) as {orderId:string};const status=await gateway.execute({operation:'getOrderStatus',tenantId:'tenant-mg',input:{orderId:result.orderId}}) as {paymentStatus:string};expect(status.paymentStatus).toBe('unpaid')})
 it('payment proof is pending review, never paid',async()=>{const result=await gateway.execute({operation:'createOrderDraft',tenantId:'tenant-mg',input:{customerId:'cus-mg-1',lines:[{productId:'mg-stock-1',quantity:1}]},idempotencyKey:'h3-order-2'}) as {orderId:string};const proof=await gateway.execute({operation:'attachPaymentProof',tenantId:'tenant-mg',input:{orderId:result.orderId,proofUrl:'sample://proof/h3'},idempotencyKey:'h3-proof-1'}) as {status:string};expect(proof.status).toBe('pending_review');const status=await gateway.execute({operation:'getOrderStatus',tenantId:'tenant-mg',input:{orderId:result.orderId}}) as {paymentStatus:string};expect(status.paymentStatus).toBe('pending_review')})
 it('resolves omnichannel identity through H6 gateway',async()=>{const resolved=await gateway.execute({operation:'resolveCustomerIdentity',tenantId:'tenant-mg',input:{channel:'WHATSAPP',externalIdentifier:'300 555 0101'}}) as {customerId:string;identityId:string;createdCustomer:boolean;createdIdentity:boolean};expect(resolved.customerId).toBe('cus-mg-1');expect(resolved.identityId).toBeTruthy();expect(resolved.createdCustomer).toBe(false);expect(resolved.createdIdentity).toBe(false)})
})


describe('authenticated administrative actor contract', () => {
  it('accepts PLATFORM_OWNER as a CommerceGateway request actor', () => {
    const request = {
      operation: 'listOrders',
      tenantId: 'tenant-floes',
      input: {},
      actor: {
        actorId: 'firebase-owner-test',
        role: 'PLATFORM_OWNER',
      },
    } satisfies import('./commerceGateway.js').CommerceGatewayRequest

    expect(request.actor.actorId).toBe('firebase-owner-test')
    expect(request.actor.role).toBe('PLATFORM_OWNER')
  })
})
