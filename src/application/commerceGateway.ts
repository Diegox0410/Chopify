import type {
  ActorContext,
  CommerceProduct,
  Customer,
  Order,
  PaymentProof,
} from '../domain/index.js'
import { effectiveSalePrice } from '../domain/index.js'
import { floesCatalog } from '../data/catalog/floes.js'

import type { CommercialApplication } from './commercial.js'
import type { OrderApplication } from './orders.js'
import type { BusinessCommerceAdapter } from './commercePort.js'
import type { SupervisorApplication } from './supervisor.js'
import type { CustomerIdentityResolver } from './customerIdentityResolver.js'

export type CommerceGatewayOperation =
  | 'searchProducts'
  | 'getProductDetails'
  | 'checkAvailability'
  | 'createOrUpdateCustomer'
  | 'createOpportunity'
  | 'createOrderDraft'
  | 'attachPaymentProof'
  | 'getOrderStatus'
  | 'requestHumanEscalation'
  | 'resolveCustomerIdentity'
  | 'approvePayment'
  | 'rejectPaymentProof'
  | 'startPreparation'
  | 'markReady'
  | 'dispatchOrder'
  | 'markDelivered'
  | 'listProducts'
  | 'syncFloesCatalog'
  | 'updateProduct'
  | 'ownerDashboard'
  | 'listOrders'
  | 'getOrderDetail'
  | 'listPaymentReviews'
  | 'listCustomers'
  | 'listOpportunities'
  | 'listExceptions'

export interface CommerceGatewayRequest {
  operation: CommerceGatewayOperation
  tenantId: string
  input: Record<string, unknown>
  idempotencyKey?: string
  correlationId?: string
  requestId?: string
  actor?: ActorContext
}

const money=(cents:number,currency:string)=>({amount:cents/100,currency})
const product=(item:CommerceProduct)=>({
 productId:item.id,name:item.name,sku:item.sku,slug:item.slug,description:item.description,commercialSummary:item.commercialSummary,category:item.category,
 price:item.salePriceCents===null?null:money(item.salePriceCents,item.currency),pricingStatus:item.pricingStatus,
 available:item.fulfillmentMode==='MADE_TO_ORDER'||item.fulfillmentMode==='SERVICE'||item.fulfillmentMode==='DIGITAL'||item.fulfillmentMode==='HYBRID'||item.variants.some((variant)=>variant.stock!==null&&variant.stock>0),
 availabilityStatus:item.fulfillmentMode==='STOCK'&&item.variants.length>0&&item.variants.every((variant)=>variant.stock===null)?'NOT_CONFIGURED':'AVAILABLE_BY_MODE',
 imageUrl:item.images[0]?.url,images:item.images,fulfillmentMode:item.fulfillmentMode,status:item.status,visibility:item.visibility,
 variants:item.variants.filter((variant)=>variant.status==='ACTIVE'&&variant.visibility==='VISIBLE').map((variant)=>({variantId:variant.id,name:variant.color??variant.sku,color:variant.color,sku:variant.sku,price:effectiveSalePrice(item,variant)===null?null:money(effectiveSalePrice(item,variant)!,item.currency),pricingStatus:effectiveSalePrice(item,variant)===null?'PENDING':'READY',available:['MADE_TO_ORDER','SERVICE','DIGITAL','HYBRID'].includes(variant.fulfillmentMode??item.fulfillmentMode)||(variant.stock!==null&&variant.stock>0),availableQuantity:variant.stock,availabilityStatus:variant.stock===null?'NOT_CONFIGURED':variant.stock>0?'AVAILABLE':'OUT_OF_STOCK',images:variant.images,fulfillmentMode:variant.fulfillmentMode??item.fulfillmentMode})),
 metadata:{fulfillmentMode:item.fulfillmentMode,pricingStatus:item.pricingStatus},
})
const customer=(item:Customer)=>({customerId:item.id,name:item.name,phone:item.phone,email:item.email})
const actor=(tenantId:string):ActorContext=>({actorId:'ganobot-commerce',role:'AUTOMATION',tenantId})
const humanActor=(tenantId:string,requestActor?:ActorContext):ActorContext=>{
 if(requestActor){
  if(requestActor.role!=='PLATFORM_OWNER'&&requestActor.tenantId!==tenantId)throw new Error('Actor tenant mismatch')
  return requestActor.role==='PLATFORM_OWNER'
   ? {actorId:requestActor.actorId,role:'PLATFORM_OWNER'}
   : {...requestActor,tenantId}
 }
 return {actorId:'chopify-operations',role:'TENANT_OWNER',tenantId}
}
const requiredString=(value:unknown,label:string)=>{
 if(typeof value!=='string'||!value.trim())throw new Error(`${label} is required`)
 return value.trim()
}
const optionalString=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():undefined
const status=(order:Order)=>({
 orderId:order.id,
 status:order.orderStatus==='CANCELLED'?'cancelled':
  order.fulfillmentStatus==='DELIVERED'?'delivered':
  order.fulfillmentStatus==='DISPATCHED'?'dispatched':
  order.fulfillmentStatus==='PREPARING'||order.fulfillmentStatus==='READY'?'preparing':
  order.paymentStatus==='PAID'?'paid':
  order.paymentStatus==='PROOF_RECEIVED'||order.paymentStatus==='UNDER_REVIEW'?'payment-under-review':
  order.orderStatus==='CREATED'?'draft':'awaiting-payment',
 paymentStatus:order.paymentStatus==='PAID'?'approved':order.paymentStatus==='REJECTED'?'rejected':
  order.paymentStatus==='PROOF_RECEIVED'||order.paymentStatus==='UNDER_REVIEW'?'pending_review':'unpaid',
 fulfillmentStatus:order.fulfillmentStatus==='DELIVERED'?'delivered':order.fulfillmentStatus==='DISPATCHED'?'dispatched':
  order.fulfillmentStatus==='PREPARING'||order.fulfillmentStatus==='READY'?'preparing':'unfulfilled',
 total:money(order.grandTotalCents,order.currency),
})

export class CommerceGateway {
 constructor(
  private commercial:CommercialApplication,
  private orders:OrderApplication,
  private commerce:BusinessCommerceAdapter,
  private supervisor:SupervisorApplication,
  private identityResolver:CustomerIdentityResolver,
 ){}

 async execute(request:CommerceGatewayRequest):Promise<unknown>{
  const {tenantId,input}=request
  switch(request.operation){
   case 'searchProducts':{
    const q=optionalString(input.query)??''
    const limit=typeof input.limit==='number'?Math.max(1,Math.min(20,Math.floor(input.limit))):10
    return (await this.commerce.searchProducts(tenantId,q)).slice(0,limit).map(product)
   }
   case 'listProducts': return this.commerce.listProducts(tenantId)
   case 'syncFloesCatalog':{
    if(tenantId!=='tenant-floes')throw new Error('FLOES catalog import is restricted to tenant-floes')
    const existing=await this.commerce.listProducts(tenantId);const ids=new Set(existing.map((item)=>item.id));const missing=floesCatalog.filter((item)=>!ids.has(item.id))
    return missing.length?this.commerce.upsertProducts(tenantId,missing):existing
   }
   case 'updateProduct':{
    const raw=input.product
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('product is required')
    const productInput=raw as Partial<CommerceProduct>
    const existing=typeof productInput.id==='string'?await this.commerce.getProduct(tenantId,productInput.id):null
    const candidate={...(existing??{}),...productInput,tenantId} as CommerceProduct
    if(!candidate.id||!candidate.name||!candidate.sku||!candidate.slug)throw new Error('Product id, name, sku and slug are required')
    await this.commerce.upsertProducts(tenantId,[candidate])
    return candidate
   }
   case 'getProductDetails':{
    const item=await this.commerce.getProduct(tenantId,requiredString(input.productId,'productId'))
    return item?product(item):undefined
   }
   case 'checkAvailability':{
    const productId=requiredString(input.productId,'productId');const variantId=optionalString(input.variantId)
    const item=await this.commerce.getProduct(tenantId,productId,variantId)
    if(!item)return{productId,variantId,available:false,availableQuantity:0,reason:'not_found'}
    const quantity=typeof input.quantity==='number'?Math.max(1,Math.floor(input.quantity)):1
    const variant=variantId?item.variants.find((entry)=>entry.id===variantId&&entry.status==='ACTIVE'&&entry.visibility==='VISIBLE'):undefined
    if(variantId&&!variant)return{productId,variantId,available:false,reason:'variant_not_found'}
    const mode=variant?.fulfillmentMode??item.fulfillmentMode
    const available=await this.commerce.getAvailability(tenantId,productId,variantId)
    const canFulfill=['MADE_TO_ORDER','SERVICE','DIGITAL','HYBRID'].includes(mode)||(available!==null&&available>=quantity)
    const reason=available===null&&mode==='STOCK'?'inventory_not_configured':mode==='HYBRID'&&(available===null||available<quantity)?'made_to_order_fallback':canFulfill&&mode==='MADE_TO_ORDER'?'made_to_order':canFulfill?undefined:'insufficient_stock'
    return{productId,variantId,available:canFulfill,...(mode==='STOCK'||mode==='HYBRID'?{availableQuantity:available}:{}),availabilityStatus:available===null?'NOT_CONFIGURED':available>=quantity?'AVAILABLE':'OUT_OF_STOCK',reason,fulfillmentMode:mode,pricingStatus:item.pricingStatus}
   }
   case 'createOrUpdateCustomer':{
    const customerId=optionalString(input.customerId)
    if(customerId){
     const existing=await this.commercial.getCustomerDetail(tenantId,customerId)
     if(existing)return customer(await this.commercial.updateCustomer(tenantId,customerId,{
      name:optionalString(input.name)??existing.customer.name,phone:optionalString(input.phone),
      email:optionalString(input.email),acquisitionSource:optionalString(input.channel),
     }))
    }
    const name=optionalString(input.name)??optionalString(input.phone)??optionalString(input.email)??'Cliente'
    return customer(await this.commercial.createCustomer({tenantId,name,phone:optionalString(input.phone),email:optionalString(input.email),acquisitionSource:optionalString(input.channel)}))
   }
   case 'resolveCustomerIdentity':{
    const channel=requiredString(input.channel,'channel')
    const allowedChannels=new Set(['WHATSAPP','INSTAGRAM','FACEBOOK','WEB','OTHER'] as const)
    if(!allowedChannels.has(channel as 'WHATSAPP'|'INSTAGRAM'|'FACEBOOK'|'WEB'|'OTHER'))throw new Error('Invalid identity channel')
    const resolved=await this.identityResolver.resolve({
     tenantId,channel:channel as 'WHATSAPP'|'INSTAGRAM'|'FACEBOOK'|'WEB'|'OTHER',
     externalIdentifier:requiredString(input.externalIdentifier,'externalIdentifier'),
     name:optionalString(input.name),phone:optionalString(input.phone),email:optionalString(input.email),
     acquisitionSource:optionalString(input.acquisitionSource),
    })
    return{
     customerId:resolved.customer.id,identityId:resolved.identity.id,channel:resolved.identity.channel,
     externalIdentifier:resolved.identity.externalIdentifier,createdCustomer:resolved.createdCustomer,createdIdentity:resolved.createdIdentity,
    }
   }
   case 'createOpportunity':{
    const customerId=requiredString(input.customerId,'customerId')
    const ids=Array.isArray(input.productIds)?input.productIds.filter((v):v is string=>typeof v==='string'):[]
    let cents: number;let currency: string
    if(ids[0]){
     const item=await this.commerce.getProduct(tenantId,ids[0]);if(!item)throw new Error('Product not found in tenant')
     if(item.salePriceCents===null)throw new Error('Product pricing is pending')
     cents=item.salePriceCents;currency=item.currency
    }else{
     if(typeof input.estimatedValueCents!=='number'||!Number.isInteger(input.estimatedValueCents)||input.estimatedValueCents<0)throw new Error('estimatedValueCents must be explicit')
     cents=input.estimatedValueCents;currency=requiredString(input.currency,'currency').toUpperCase()
    }
    const opportunity=await this.commercial.createOpportunity({tenantId,customerId,intent:'PURCHASE_INTENT',estimatedValueCents:cents,currency,acquisitionSource:optionalString(input.source),conversionChannel:optionalString(input.source),assignedTo:'ganobot'})
    return{opportunityId:opportunity.id,customerId:opportunity.customerId,status:'new'}
   }
   case 'createOrderDraft':{
    const customerId=requiredString(input.customerId,'customerId');let opportunityId=optionalString(input.opportunityId)
    const lines=Array.isArray(input.lines)?input.lines:[]
    const items=lines.map(line=>{
     if(typeof line!=='object'||!line)throw new Error('Invalid order line')
     const record=line as Record<string,unknown>;const quantity=typeof record.quantity==='number'?Math.floor(record.quantity):0
     if(quantity<1)throw new Error('quantity must be positive')
     return{productId:requiredString(record.productId,'productId'),variantId:optionalString(record.variantId),quantity}
    })
    if(!opportunityId){
     if(items.length===0)throw new Error('Order lines are required')
     const first=await this.commerce.getProduct(tenantId,items[0].productId,items[0].variantId)
     if(!first)throw new Error('Product not found in tenant')
     const firstVariant=items[0].variantId?first.variants.find(item=>item.id===items[0].variantId):undefined
     const firstPrice=effectiveSalePrice(first,firstVariant)
     if(firstPrice===null)throw new Error('Product pricing is pending')
     const o=await this.commercial.createOpportunity({tenantId,customerId,intent:'PURCHASE_INTENT',estimatedValueCents:firstPrice*items[0].quantity,currency:first.currency,assignedTo:'ganobot'});opportunityId=o.id
    }
    let opportunity=await this.commercial.getOpportunity(tenantId,opportunityId)
    if(!opportunity)throw new Error('Opportunity not found in tenant')
    if(opportunity.status==='OPEN')opportunity=await this.commercial.qualifyOpportunity(tenantId,opportunity.id)
    if(opportunity.status==='QUALIFIED')opportunity=await this.commercial.startOpportunityCart(tenantId,opportunity.id)
    if(opportunity.status==='CART_STARTED')opportunity=await this.commercial.markOpportunityOrderCreated(tenantId,opportunity.id)
    const order=await this.orders.createOrderFromOpportunity({tenantId,opportunityId:opportunity.id,items,managed:true,managedBy:'AUTOMATION',idempotencyKey:request.idempotencyKey??`${tenantId}:${request.requestId??opportunity.id}:createOrderDraft`,actor:actor(tenantId)})
    return{orderId:order.id,status:'draft',customerId:order.customerId,total:money(order.grandTotalCents,order.currency)}
   }
   case 'attachPaymentProof':{
    const orderId=requiredString(input.orderId,'orderId')
    const proof:PaymentProof=await this.orders.submitPaymentProof({tenantId,orderId,reference:optionalString(input.externalReference),assetReference:optionalString(input.proofUrl),idempotencyKey:request.idempotencyKey??`${tenantId}:${request.requestId??orderId}:attachPaymentProof`,actor:actor(tenantId)})
    return{proofId:proof.id,paymentId:proof.paymentId,orderId:proof.orderId,status:'pending_review'}
   }
   case 'getOrderStatus':{
    const order=await this.orders.getOrder(tenantId,requiredString(input.orderId,'orderId'))
    return order?status(order):undefined
   }
   case 'ownerDashboard': return this.orders.dashboard(tenantId)
   case 'listOrders':{
    const orders=await this.orders.listOrders(tenantId)
    return Promise.all(orders.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(async order=>{
     const detail=await this.commercial.getCustomerDetail(tenantId,order.customerId)
     return{...order,customer:detail?customer(detail.customer):null}
    }))
   }
   case 'getOrderDetail':{
    const detail=await this.orders.getOrderDetail(tenantId,requiredString(input.orderId,'orderId'))
    if(!detail)return undefined
    const customerDetail=await this.commercial.getCustomerDetail(tenantId,detail.order.customerId)
    return{...detail,customer:customerDetail?customer(customerDetail.customer):null}
   }
   case 'listPaymentReviews': return this.orders.paymentReviews(tenantId)
   case 'listCustomers': return this.commercial.listCustomers(tenantId)
   case 'listOpportunities': return this.commercial.listOpportunities(tenantId)
   case 'listExceptions': return this.supervisor.snapshot(tenantId)
   case 'requestHumanEscalation':{
    const conversationId=requiredString(input.conversationId,'conversationId');const reason=requiredString(input.reason,'reason')
    const allowedReasons=new Set(['CUSTOMER_REQUEST','COMPLAINT','PAYMENT_ISSUE','PRICING_EXCEPTION','STOCK_CONFLICT','RETURN_REQUEST','DELIVERY_ISSUE','UNKNOWN_PRODUCT','SYSTEM_ERROR','OTHER'] as const)
    type Reason='CUSTOMER_REQUEST'|'COMPLAINT'|'PAYMENT_ISSUE'|'PRICING_EXCEPTION'|'STOCK_CONFLICT'|'RETURN_REQUEST'|'DELIVERY_ISSUE'|'UNKNOWN_PRODUCT'|'SYSTEM_ERROR'|'OTHER'
    if(!allowedReasons.has(reason as Reason))throw new Error('Invalid escalation reason')
    const rawPriority=optionalString(input.priority);const priority=rawPriority==='LOW'||rawPriority==='NORMAL'||rawPriority==='HIGH'||rawPriority==='URGENT'?rawPriority:undefined
    if(rawPriority&&!priority)throw new Error('Invalid escalation priority')
    const escalation=await this.supervisor.escalate({tenantId,conversationId,reason:reason as Reason,priority,contextSummary:optionalString(input.contextSummary),orderId:optionalString(input.orderId)})
    return{escalationId:escalation.id,conversationId:escalation.conversationId,status:escalation.status,reason:escalation.reason,priority:escalation.priority}
   }
   case 'approvePayment':{
    const paymentId=requiredString(input.paymentId,'paymentId');const proofId=requiredString(input.proofId,'proofId')
    const payment=await this.orders.approvePayment({tenantId,paymentId,proofId,idempotencyKey:request.idempotencyKey??`${tenantId}:${request.requestId??proofId}:approvePayment`,actor:humanActor(tenantId,request.actor)})
    return{paymentId:payment.id,orderId:payment.orderId,status:'approved'}
   }
   case 'rejectPaymentProof':{
    const paymentId=requiredString(input.paymentId,'paymentId');const proofId=requiredString(input.proofId,'proofId')
    const proof=await this.orders.rejectPaymentProof({tenantId,paymentId,proofId,reason:requiredString(input.reason,'reason'),idempotencyKey:request.idempotencyKey??`${tenantId}:${request.requestId??proofId}:rejectPaymentProof`,actor:humanActor(tenantId,request.actor)})
    return{paymentId:proof.paymentId,proofId:proof.id,orderId:proof.orderId,status:'rejected'}
   }
   case 'startPreparation':{
    return status(await this.orders.startPreparation(tenantId,requiredString(input.orderId,'orderId'),humanActor(tenantId,request.actor)))
   }
   case 'markReady':{
    return status(await this.orders.markReady(tenantId,requiredString(input.orderId,'orderId'),humanActor(tenantId,request.actor)))
   }
   case 'dispatchOrder':{
    return status(await this.orders.dispatchOrder(tenantId,requiredString(input.orderId,'orderId'),humanActor(tenantId,request.actor),{courier:optionalString(input.courier),trackingCode:optionalString(input.trackingCode)}))
   }
   case 'markDelivered':{
    return status(await this.orders.markDelivered(tenantId,requiredString(input.orderId,'orderId'),humanActor(tenantId,request.actor)))
   }
  }
 }
}
