import { timingSafeEqual } from 'node:crypto'
import type { CommerceGatewayOperation } from '../src/application/commerceGateway.js'
import { PersistentCommerceRuntime } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
import { isKnownTenant } from '../src/config/tenantRegistry.js'
interface CommerceRequest{method?:string;headers:Record<string,string|string[]|undefined>;body?:unknown}
interface CommerceResponse{statusCode:number;setHeader(name:string,value:string):void;end(body?:string):void}
interface CommerceRequestBody{operation?:CommerceGatewayOperation;tenantId?:unknown;input?:unknown;idempotencyKey?:unknown}
const runtime=new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
const operations=new Set<CommerceGatewayOperation>([
 'searchProducts','getProductDetails','checkAvailability','createOrUpdateCustomer','createOpportunity','createOrderDraft',
 'attachPaymentProof','getOrderStatus','requestHumanEscalation','resolveCustomerIdentity',
 'approvePayment','rejectPaymentProof','startPreparation','markReady','dispatchOrder','markDelivered',
 'listProducts','syncFloesCatalog','updateProduct',
 'ownerDashboard','listOrders','getOrderDetail','listPaymentReviews',
])
const humanOperations=new Set<CommerceGatewayOperation>([
 'approvePayment','rejectPaymentProof','startPreparation','markReady','dispatchOrder','markDelivered',
 'listProducts','syncFloesCatalog','updateProduct',
 'ownerDashboard','listOrders','getOrderDetail','listPaymentReviews',
])
const json=(res:CommerceResponse,status:number,body:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body))}
const headerValue=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]??'':value??''
const secureEqual=(a:string,b:string)=>{const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
const allowedTenant=(tenantId:string)=>(process.env.CHOPIFY_COMMERCE_ALLOWED_TENANTS??'tenant-floes,tenant-mg,tenant-dgng').split(',').map(i=>i.trim()).filter(Boolean).includes(tenantId)
const operationsTenant=(tenantId:string)=>(process.env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS??'tenant-floes').split(',').map(i=>i.trim()).filter(Boolean).includes(tenantId)
const parseBody=(body:unknown):CommerceRequestBody=>{
 if(typeof body==='string'){const parsed:unknown=JSON.parse(body);return parsed&&typeof parsed==='object'?parsed as CommerceRequestBody:{}}
 return body&&typeof body==='object'?body as CommerceRequestBody:{}
}
export default async function handler(req:CommerceRequest,res:CommerceResponse){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'})
 let body:CommerceRequestBody
 try{body=parseBody(req.body)}catch{return json(res,400,{error:'Invalid JSON body'})}
 const operation=body.operation
 if(!operation||!operations.has(operation))return json(res,400,{error:'Unknown commerce operation'})
 const tenantId=headerValue(req.headers['x-chopify-tenant-id']).trim()
 const accessScope=headerValue(req.headers['x-chopify-access-scope']).trim()
 const ownerTokens:Record<string,string|undefined>={'tenant-floes':process.env.CHOPIFY_OWNER_API_TOKEN_FLOES,'tenant-mg':process.env.CHOPIFY_OWNER_API_TOKEN_MG,'tenant-dgng':process.env.CHOPIFY_OWNER_API_TOKEN_DGNG}
 const supplied=headerValue(req.headers.authorization).replace(/^Bearer\s+/i,'')
 let credentialTenant:string|undefined
 if(accessScope==='owner')credentialTenant=Object.entries(ownerTokens).find(([,token])=>Boolean(token&&supplied&&secureEqual(supplied,token)))?.[0]
 const expected=accessScope==='owner'?undefined:humanOperations.has(operation)?process.env.CHOPIFY_OPERATIONS_API_TOKEN:process.env.CHOPIFY_COMMERCE_API_TOKEN
 if(accessScope==='owner'?!credentialTenant:!expected||!supplied||!secureEqual(supplied,expected))return json(res,401,{error:'Unauthorized'})
 if(!isKnownTenant(tenantId)||!allowedTenant(tenantId))return json(res,403,{error:'Tenant not allowed'})
 if(accessScope==='owner'&&credentialTenant!==tenantId)return json(res,403,{error:'Tenant not allowed for owner'})
 if(accessScope==='owner'&&!humanOperations.has(operation))return json(res,403,{error:'Operation not allowed for owner'})
 if(accessScope!=='owner'&&humanOperations.has(operation)&&!operationsTenant(tenantId))return json(res,403,{error:'Tenant not allowed for operations'})
 if(body.tenantId!==undefined)return json(res,400,{error:'tenantId must be supplied only by authenticated header'})
 const input=body.input&&typeof body.input==='object'?body.input as Record<string,unknown>:{}
 try{
  const data=await runtime.execute({operation,tenantId,input,idempotencyKey:typeof body.idempotencyKey==='string'?body.idempotencyKey:undefined,
   correlationId:headerValue(req.headers['x-correlation-id'])||undefined,requestId:headerValue(req.headers['x-request-id'])||undefined})
  return json(res,200,{ok:true,data})
 }catch(error){
  console.error('Commerce runtime error:',error instanceof Error?error.message:'unknown')
  return json(res,400,{ok:false,error:error instanceof Error?error.message:'Commerce operation failed'})
 }
}
