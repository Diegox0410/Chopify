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

export interface CommerceRuntimeState {schemaVersion:3;commercial:SampleDatabase;orders:SampleOrderDatabase}
export interface CommerceStateRecord {state:CommerceRuntimeState;version:string|null;migrated?:boolean}
export interface CommerceStateStore {
 load(tenantId:string):Promise<CommerceStateRecord|null>
 save(tenantId:string,state:CommerceRuntimeState,expectedVersion:string|null):Promise<string>
}
export class CommerceStateConflictError extends Error{constructor(){super('Commerce state changed concurrently');this.name='CommerceStateConflictError'}}
const tenants={
 'tenant-mg':{id:'tenant-mg',slug:'mg',name:'MG Salud y Belleza',status:'ACTIVE',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'},
 'tenant-dgng':{id:'tenant-dgng',slug:'dgng',name:'DGNG',status:'ACTIVE',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'},
 'tenant-floes':{id:'tenant-floes',slug:'floes',name:'FLOES',status:'ACTIVE',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'},
} as const
export function createTenantCommerceState(tenantId:string):CommerceRuntimeState{
 const tenant=tenants[tenantId as keyof typeof tenants]
 if(!tenant)throw new Error('Unknown tenant')
 return{schemaVersion:3,commercial:{
  tenants:[structuredClone(tenant)],customers:[],identities:[],conversations:[],opportunities:[],activities:[],notes:[],tasks:[],escalations:[],
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
 const mergedProducts=tenantId==='tenant-floes'?[...products,...seeded.orders.products.filter(seed=>!products.some(item=>item.id===seed.id))]:products
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
  identities,conversations,opportunities,activities,notes,tasks,escalations},orders:{products:mergedProducts,orders,
  payments,proofs,reservations,idempotency,inventory,agreements,audit,publishedOrderIds:[...legacy.orders.publishedOrderIds]}}
}
function buildGateway(state:CommerceRuntimeState){
 const commercialRepositories=createSampleRepositories(state.commercial);const orderRepositories=createSampleOrderRepositories(state.orders)
 const commercial=new CommercialApplication(commercialRepositories)
 const orders=new OrderApplication({tenants:commercialRepositories.tenants,customers:commercialRepositories.customers,opportunities:commercialRepositories.opportunities,activities:commercialRepositories.activities,...orderRepositories})
 const supervisor=new SupervisorApplication({...commercialRepositories,orders:orderRepositories.orders,proofs:orderRepositories.proofs})
 const identityResolver=new CustomerIdentityResolver(commercialRepositories)
 return new CommerceGateway(commercial,orders,orderRepositories.commerce,supervisor,identityResolver)
}
const MUTATIONS=new Set<CommerceGatewayRequest['operation']>([
 'createOrUpdateCustomer','createOpportunity','createOrderDraft','attachPaymentProof','requestHumanEscalation','resolveCustomerIdentity',
 'approvePayment','rejectPaymentProof','startPreparation','markReady','dispatchOrder','markDelivered',
 'syncFloesCatalog','updateProduct',
])
export class PersistentCommerceRuntime{
 constructor(private readonly store:CommerceStateStore,private readonly maxAttempts=4){}
 async execute(request:CommerceGatewayRequest):Promise<unknown>{
  for(let attempt=1;attempt<=this.maxAttempts;attempt+=1){
   const loaded=await this.store.load(request.tenantId);const state=loaded?.state??createTenantCommerceState(request.tenantId)
   const result=await buildGateway(state).execute(request)
   const shouldPersist=MUTATIONS.has(request.operation)||!loaded||loaded.migrated===true
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
