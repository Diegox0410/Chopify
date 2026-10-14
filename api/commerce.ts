import { authorizeOwnerService, bearerValue, equalSecret } from './_lib/ownerServiceAuth.js'
import { orderNotifier } from './_lib/orderNotificationRuntime.js'
import type { NotificationResult } from './_lib/orderNotificationRuntime.js'
import type { CommerceGatewayOperation } from '../src/application/commerceGateway.js'
import { PersistentCommerceRuntime } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
import { isKnownTenant } from '../src/config/tenantRegistry.js'
import type { ActorContext } from '../src/domain/index.js'
interface CommerceRequest{method?:string;headers:Record<string,string|string[]|undefined>;body?:unknown}
interface CommerceResponse{statusCode:number;setHeader(name:string,value:string):void;end(body?:string):void}
interface CommerceRequestBody{operation?:CommerceGatewayOperation;tenantId?:unknown;input?:unknown;idempotencyKey?:unknown}
const runtime=new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
const operations=new Set<CommerceGatewayOperation>([
 'searchProducts','getProductDetails','checkAvailability','createOrUpdateCustomer','createOpportunity','createOrderDraft',
 'attachPaymentProof','getOrderStatus','requestHumanEscalation','resolveCustomerIdentity','updateOrderDelivery','recordOrderFollowUp',
 'approvePayment','rejectPaymentProof','startPreparation','markReady','dispatchOrder','markDelivered',
 'listProducts','syncFloesCatalog','updateProduct','previewCatalogImport','importCatalog',
 'ownerDashboard','listOrders','getOrderDetail','listPaymentReviews',
 'listCustomers','listOpportunities','listExceptions','getCatalogSnapshot','addCustomerNote','resolveEscalation','listOrderActivities',
])
const humanOperations=new Set<CommerceGatewayOperation>([
 'approvePayment','rejectPaymentProof','startPreparation','markReady','dispatchOrder','markDelivered',
 'listProducts','syncFloesCatalog','updateProduct','previewCatalogImport','importCatalog',
 'ownerDashboard','listOrders','getOrderDetail','listPaymentReviews',
 'listCustomers','listOpportunities','listExceptions','getCatalogSnapshot','addCustomerNote','resolveEscalation','listOrderActivities',
])
const json=(res:CommerceResponse,status:number,body:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Chopify-Service','commerce');res.end(JSON.stringify(body))}
const headerValue=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]??'':value??''
const allowedTenant=(tenantId:string,env:NodeJS.ProcessEnv)=>(env.CHOPIFY_COMMERCE_ALLOWED_TENANTS??(env.VERCEL_ENV==='preview'?'tenant-floes':'tenant-floes,tenant-mg,tenant-dgng')).split(',').map(i=>i.trim()).filter(Boolean).includes(tenantId)
const operationsTenant=(tenantId:string,env:NodeJS.ProcessEnv)=>(env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS??'tenant-floes').split(',').map(i=>i.trim()).filter(Boolean).includes(tenantId)
const parseBody=(body:unknown):CommerceRequestBody=>{
 if(typeof body==='string'){const parsed:unknown=JSON.parse(body);return parsed&&typeof parsed==='object'?parsed as CommerceRequestBody:{}}
 return body&&typeof body==='object'?body as CommerceRequestBody:{}
}
export function createCommerceHandler(dependencies:{runtimeClient?:Pick<PersistentCommerceRuntime,'execute'>;env?:NodeJS.ProcessEnv;notify?:ReturnType<typeof orderNotifier>}={}){
 const runtimeClient=dependencies.runtimeClient??runtime
 const env=dependencies.env??process.env
 const notify=dependencies.notify??orderNotifier(runtimeClient)
 return async function handler(req:CommerceRequest,res:CommerceResponse){
 res.setHeader('X-Chopify-Commerce-Collection',env.CHOPIFY_COMMERCE_STATE_COLLECTION?.trim()||'chopifyCommerceRuntime')
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'})
 let body:CommerceRequestBody
 try{body=parseBody(req.body)}catch{return json(res,400,{error:'Invalid JSON body'})}
 const operation=body.operation
 if(!operation||!operations.has(operation))return json(res,400,{error:'Unknown commerce operation'})
 const tenantId=headerValue(req.headers['x-chopify-tenant-id']).trim()
 const accessScope=headerValue(req.headers['x-chopify-access-scope']).trim()
 const preview=env.VERCEL_ENV==='preview'
 const supplied=bearerValue(req.headers)
 let credentialTenant:string|undefined
 let ownerActorId:string|undefined
 if(accessScope==='owner'){
  const auth=authorizeOwnerService(req,env)
  if(!auth||!auth.ok)return json(res,auth?.status??401,{error:auth&&!auth.ok?auth.error:'Unauthorized'})
  credentialTenant=auth.tenantId
  ownerActorId=auth.identity.uid
 }else{
  if(accessScope&&!['commerce','operations'].includes(accessScope))return json(res,403,{error:'Unknown access scope'})
  const expected=humanOperations.has(operation)?env.CHOPIFY_OPERATIONS_API_TOKEN:preview?env.CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN??env.CHOPIFY_COMMERCE_API_TOKEN:env.CHOPIFY_COMMERCE_API_TOKEN
  if(!equalSecret(supplied,expected))return json(res,401,{error:'Unauthorized'})
 }
 if(!isKnownTenant(tenantId)||!allowedTenant(tenantId,env))return json(res,403,{error:'Tenant not allowed'})
 if(accessScope==='owner'&&credentialTenant!==tenantId)return json(res,403,{error:'Tenant not allowed for owner'})
 if(accessScope==='owner'&&!humanOperations.has(operation))return json(res,403,{error:'Operation not allowed for owner'})
 if(accessScope!=='owner'&&humanOperations.has(operation)&&!operationsTenant(tenantId,env))return json(res,403,{error:'Tenant not allowed for operations'})
 if(body.tenantId!==undefined)return json(res,400,{error:'tenantId must be supplied only by authenticated header'})
 const input=body.input&&typeof body.input==='object'?body.input as Record<string,unknown>:{}
 const authenticatedActor:ActorContext=humanOperations.has(operation)
  ? {actorId:accessScope==='owner'?ownerActorId!:'chopify-operations',role:'TENANT_OWNER',tenantId}
  : {actorId:'ganobot-commerce',role:'AUTOMATION',tenantId}
 try{
  const data=await runtimeClient.execute({operation,tenantId,input,idempotencyKey:typeof body.idempotencyKey==='string'?body.idempotencyKey:undefined,
   actor:authenticatedActor,correlationId:headerValue(req.headers['x-correlation-id'])||undefined,requestId:headerValue(req.headers['x-request-id'])||undefined})
  let notification:NotificationResult
  try{notification=await notify({operation,tenantId,input,data})}
  catch{notification={status:'FAILED',reason:'NOTIFICATION_NOT_PERSISTED'};console.error(JSON.stringify({service:'commerce',stage:'notification_failed',tenantId,operation}))}
  return json(res,200,{ok:true,data,...(notification.status==='NOT_APPLICABLE'?{}:{notification})})
 }catch(error){
  console.error(JSON.stringify({service:'commerce',stage:'operation_rejected',tenantId,operation}))
  const message=error instanceof Error?error.message:'Commerce operation failed'
  return json(res,400,{ok:false,error:/Bearer |private_key|access_token=/i.test(message)?'Commerce operation failed':message})
 }
}
}
export default createCommerceHandler()
