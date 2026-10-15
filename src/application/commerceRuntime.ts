import type { SampleDatabase } from '../adapters/memory/commercialRepositories.js'
import { createSampleRepositories } from '../adapters/memory/commercialRepositories.js'
import type { SampleOrderDatabase } from '../adapters/memory/orderRepositories.js'
import { createSampleOrderRepositories } from '../adapters/memory/orderRepositories.js'
import { floesCatalog } from '../data/catalog/floes.js'
import { CommercialApplication } from './commercial.js'
import { OrderApplication } from './orders.js'
import { SupervisorApplication } from './supervisor.js'
import { CustomerIdentityResolver } from './customerIdentityResolver.js'
import { CommerceGateway,type CommerceGatewayRequest } from './commerceGateway.js'
import { tenantDefinitions } from '../config/tenantRegistry.js'
import { createOwnerCatalogSnapshot } from './catalogSnapshot.js'

export { tenantDefinitions } from '../config/tenantRegistry.js'

export interface CommerceRuntimeState {schemaVersion:3;commercial:SampleDatabase;orders:SampleOrderDatabase}
export interface CommerceStateRecord {state:CommerceRuntimeState;version:string|null;migrated?:boolean}
export interface CommerceStateStore {
 load(tenantId:string):Promise<CommerceStateRecord|null>
 save(tenantId:string,state:CommerceRuntimeState,expectedVersion:string|null):Promise<string>
}
export class CommerceStateConflictError extends Error{constructor(){super('Commerce state changed concurrently');this.name='CommerceStateConflictError'}}
export function createTenantCommerceState(tenantId:string):CommerceRuntimeState{
 const tenant=tenantDefinitions[tenantId]
 if(!tenant)throw new Error('Unknown tenant')
 const now='2026-01-01T00:00:00.000Z'
 return{schemaVersion:3,commercial:{
  tenants:[{...structuredClone(tenant),createdAt:now,updatedAt:now}],customers:[],identities:[],conversations:[],opportunities:[],activities:[],notes:[],tasks:[],escalations:[],
 },orders:{
  products:tenantId==='tenant-floes'?floesCatalog.map(item=>structuredClone(item)):[],orders:[],payments:[],proofs:[],reservations:[],idempotency:[],inventory:[],agreements:[],audit:[],publishedOrderIds:[],
 }}
}
const scoped=<T extends{tenantId:string}>(tenantId:string,label:string,items:readonly T[]|undefined):T[]=>{
 const source=items??[]
 const foreign=source.find(item=>item.tenantId!==tenantId)
 if(foreign)throw new Error(`Commerce state contains cross-tenant ${label}`)
 return source.map(item=>structuredClone(item))
}
const requireReferences=(label:string,values:readonly string[],known:ReadonlySet<string>)=>{
 const missing=values.find(value=>!known.has(value))
 if(missing)throw new Error(`Commerce state contains orphaned ${label}: ${missing}`)
}
export function migrateCommerceState(tenantId:string,state:unknown):CommerceRuntimeState{
 if(!state||typeof state!=='object')throw new Error('Commerce state is invalid')
 const legacy=state as {schemaVersion?:number;commercial?:SampleDatabase;orders?:Omit<SampleOrderDatabase,'products'>&{products?:SampleOrderDatabase['products']}}
 if(legacy.schemaVersion!==1&&legacy.schemaVersion!==2&&legacy.schemaVersion!==3)throw new Error(`Unsupported commerce state schema: ${String(legacy.schemaVersion)}`)
 if(!legacy.commercial||!legacy.orders)throw new Error('Commerce state is incomplete')
 const seeded=createTenantCommerceState(tenantId)
 const products=scoped(tenantId,'products',legacy.orders.products??seeded.orders.products)
 const customers=scoped(tenantId,'customers',legacy.commercial.customers);const customerIds=new Set(customers.map(item=>item.id))
 const identities=scoped(tenantId,'identities',legacy.commercial.identities)
 const conversations=scoped(tenantId,'conversations',legacy.commercial.conversations)
 const opportunities=scoped(tenantId,'opportunities',legacy.commercial.opportunities)
 const activities=scoped(tenantId,'activities',legacy.commercial.activities)
 const notes=scoped(tenantId,'notes',legacy.commercial.notes)
 const tasks=scoped(tenantId,'tasks',legacy.commercial.tasks)
 const escalations=scoped(tenantId,'escalations',legacy.commercial.escalations)
 const orders=scoped(tenantId,'orders',legacy.orders.orders);const orderIds=new Set(orders.map(item=>item.id))
 const payments=scoped(tenantId,'payments',legacy.orders.payments)
 const proofs=scoped(tenantId,'payment proofs',legacy.orders.proofs)
 const reservations=scoped(tenantId,'reservations',legacy.orders.reservations)
 const idempotency=scoped(tenantId,'idempotency records',legacy.orders.idempotency)
 const inventory=scoped(tenantId,'inventory positions',legacy.orders.inventory)
 const agreements=scoped(tenantId,'commercial agreements',legacy.orders.agreements)
 const audit=scoped(tenantId,'audit events',legacy.orders.audit)
 requireReferences('customer reference',[...identities,...conversations,...opportunities,...notes,...tasks].map(item=>item.customerId).filter((value):value is string=>typeof value==='string'),customerIds)
 requireReferences('order reference',[...payments,...proofs,...reservations].map(item=>item.orderId),orderIds)
 requireReferences('published order reference',legacy.orders.publishedOrderIds,orderIds)
 return{schemaVersion:3,commercial:{tenants:[structuredClone(seeded.commercial.tenants[0])],customers,
  identities,conversations,opportunities,activities,notes,tasks,escalations},orders:{products,orders,
  payments,proofs,reservations,idempotency,inventory,agreements,audit,publishedOrderIds:[...legacy.orders.publishedOrderIds]}}
}
function buildGateway(state:CommerceRuntimeState,trace:Pick<CommerceGatewayRequest,'correlationId'|'requestId'>={}){
 const commercialRepositories=createSampleRepositories(state.commercial);const orderRepositories=createSampleOrderRepositories(state.orders)
 const commercial=new CommercialApplication(commercialRepositories)
 const orders=new OrderApplication({tenants:commercialRepositories.tenants,customers:commercialRepositories.customers,opportunities:commercialRepositories.opportunities,activities:commercialRepositories.activities,...orderRepositories},undefined,trace)
 const supervisor=new SupervisorApplication({...commercialRepositories,orders:orderRepositories.orders,proofs:orderRepositories.proofs})
 const identityResolver=new CustomerIdentityResolver(commercialRepositories)
 return new CommerceGateway(commercial,orders,orderRepositories.commerce,supervisor,identityResolver)
}
const MUTATIONS=new Set<CommerceGatewayRequest['operation']>([
 'createOrUpdateCustomer','createOpportunity','createOrderDraft','attachPaymentProof','requestHumanEscalation','resolveCustomerIdentity',
 'approvePayment','rejectPaymentProof','startPreparation','markReady','dispatchOrder','markDelivered',
 'syncFloesCatalog','updateProduct','importCatalog','updateOrderDelivery','recordOrderFollowUp','setShippingQuote','acceptShippingQuote','addCustomerNote','resolveEscalation',
])
export class PersistentCommerceRuntime{
 constructor(private readonly store:CommerceStateStore,private readonly maxAttempts=4){}
 async readCatalogSnapshot(tenantId:string){
  if(!tenantDefinitions[tenantId])throw new Error('Unknown tenant')
  const loaded=await this.store.load(tenantId)
  if(!loaded||loaded.migrated)throw new Error('Canonical catalog snapshot requires an existing current-schema state')
  return createOwnerCatalogSnapshot({tenantId,capturedAt:new Date().toISOString(),stateVersion:loaded.version,
   products:loaded.state.orders.products,inventory:loaded.state.orders.inventory})
 }
 async executeMany(requests:readonly CommerceGatewayRequest[]):Promise<unknown[]>{
  if(requests.length===0)return[]
  const tenantId=requests[0].tenantId
  if(requests.some(request=>request.tenantId!==tenantId||MUTATIONS.has(request.operation)))throw new Error('Batch reads must use one tenant and read-only operations')
  for(let attempt=1;attempt<=this.maxAttempts;attempt+=1){
   const loaded=await this.store.load(tenantId);const state=loaded?.state??createTenantCommerceState(tenantId)
   // Reads never initialize or migrate persisted state. Missing configuration is
   // represented by an empty projection, not by an implicit Production write.
   return Promise.all(requests.map(request=>request.operation==='getCatalogSnapshot'
    ? this.readCatalogSnapshot(tenantId):buildGateway(state,request).execute(request)))
  }
  throw new Error('Commerce runtime retry limit reached')
 }
 async execute(request:CommerceGatewayRequest):Promise<unknown>{
  if(request.operation==='getCatalogSnapshot')return this.readCatalogSnapshot(request.tenantId)
  for(let attempt=1;attempt<=this.maxAttempts;attempt+=1){
   const loaded=await this.store.load(request.tenantId);const state=loaded?.state??createTenantCommerceState(request.tenantId)
   if(!loaded&&request.tenantId==='tenant-floes'&&request.operation==='importCatalog')state.orders.products=[]
   const result=await buildGateway(state,request).execute(request)
   const shouldPersist=MUTATIONS.has(request.operation)
   if(!shouldPersist)return result
   try{await this.store.save(request.tenantId,state,loaded?.version??null);return result}
   catch(error){if(!(error instanceof CommerceStateConflictError)||attempt===this.maxAttempts)throw error}
  }
  throw new Error('Commerce runtime retry limit reached')
 }
}
export class MemoryCommerceStateStore implements CommerceStateStore{
 private readonly records=new Map<string,{state:CommerceRuntimeState;version:number}>()
 async load(tenantId:string){const record=this.records.get(tenantId);return record?{state:structuredClone(record.state),version:String(record.version)}:null}
 async save(tenantId:string,state:CommerceRuntimeState,expectedVersion:string|null){
  const current=this.records.get(tenantId);if((current?String(current.version):null)!==expectedVersion)throw new CommerceStateConflictError()
  const version=(current?.version??0)+1;this.records.set(tenantId,{state:structuredClone(state),version});return String(version)
 }
}
