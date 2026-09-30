import { timingSafeEqual } from 'node:crypto'
import type { CommerceGatewayOperation } from '../src/application/commerceGateway.js'
import { PersistentCommerceRuntime } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
interface CommerceRequest{method?:string;headers:Record<string,string|string[]|undefined>;body?:unknown}
interface CommerceResponse{statusCode:number;setHeader(name:string,value:string):void;end(body?:string):void}
interface CommerceRequestBody{operation?:CommerceGatewayOperation;tenantId?:unknown;input?:unknown;idempotencyKey?:unknown}
const runtime=new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
const operations=new Set<CommerceGatewayOperation>([
 'searchProducts','getProductDetails','checkAvailability','createOrUpdateCustomer','createOpportunity','createOrderDraft',
 'attachPaymentProof','getOrderStatus','requestHumanEscalation','resolveCustomerIdentity',
 'approvePayment','rejectPaymentProof','startPreparation','markReady','dispatchOrder','markDelivered',
])
const humanOperations=new Set<CommerceGatewayOperation>([
 'approvePayment','rejectPaymentProof','startPreparation','markReady','dispatchOrder','markDelivered',
])
const json=(res:CommerceResponse,status:number,body:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body))}
const headerValue=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]??'':value??''
const secureEqual=(a:string,b:string)=>{const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
const allowedTenant=(tenantId:string)=>(process.env.CHOPIFY_COMMERCE_ALLOWED_TENANTS??'tenant-floes,tenant-mg,tenant-dgng').split(',').map(i=>i.trim()).filter(Boolean).includes(tenantId)
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
 const expected=humanOperations.has(operation)?process.env.CHOPIFY_OPERATIONS_API_TOKEN??'':process.env.CHOPIFY_COMMERCE_API_TOKEN??''
 const supplied=headerValue(req.headers.authorization).replace(/^Bearer\s+/i,'')
 if(!expected||!supplied||!secureEqual(supplied,expected))return json(res,401,{error:'Unauthorized'})
 const tenantId=headerValue(req.headers['x-chopify-tenant-id']).trim()
 if(!tenantId||!allowedTenant(tenantId))return json(res,403,{error:'Tenant not allowed'})
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
