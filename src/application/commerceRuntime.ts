import type { SampleDatabase } from '../adapters/memory/commercialRepositories'
import { createSampleDatabase, createSampleRepositories } from '../adapters/memory/commercialRepositories'
import type { SampleOrderDatabase } from '../adapters/memory/orderRepositories'
import { createSampleOrderDatabase, createSampleOrderRepositories } from '../adapters/memory/orderRepositories'
import { CommercialApplication } from './commercial'
import { OrderApplication } from './orders'
import { CommerceGateway, type CommerceGatewayRequest } from './commerceGateway'

export interface CommerceRuntimeState {
  schemaVersion: 1
  commercial: SampleDatabase
  orders: SampleOrderDatabase
}
export interface CommerceStateRecord { state: CommerceRuntimeState; version: string | null }
export interface CommerceStateStore {
  load(tenantId: string): Promise<CommerceStateRecord | null>
  save(tenantId: string, state: CommerceRuntimeState, expectedVersion: string | null): Promise<string>
}
export class CommerceStateConflictError extends Error { constructor(){super('Commerce state changed concurrently');this.name='CommerceStateConflictError'} }

const byTenant=<T extends {tenantId:string}>(items:readonly T[],tenantId:string)=>items.filter(item=>item.tenantId===tenantId).map(item=>structuredClone(item))
export function createTenantCommerceState(tenantId:string):CommerceRuntimeState {
  const commercial=createSampleDatabase(); const orders=createSampleOrderDatabase()
  const tenant=commercial.tenants.find(item=>item.id===tenantId); if(!tenant)throw new Error('Unknown tenant')
  const tenantOrderIds=new Set(orders.orders.filter(item=>item.tenantId===tenantId).map(item=>item.id))
  return {schemaVersion:1,commercial:{tenants:[structuredClone(tenant)],customers:byTenant(commercial.customers,tenantId),identities:byTenant(commercial.identities,tenantId),conversations:byTenant(commercial.conversations,tenantId),opportunities:byTenant(commercial.opportunities,tenantId),activities:byTenant(commercial.activities,tenantId),notes:byTenant(commercial.notes,tenantId),tasks:byTenant(commercial.tasks,tenantId),escalations:byTenant(commercial.escalations,tenantId)},orders:{orders:byTenant(orders.orders,tenantId),payments:byTenant(orders.payments,tenantId),proofs:byTenant(orders.proofs,tenantId),reservations:byTenant(orders.reservations,tenantId),idempotency:byTenant(orders.idempotency,tenantId),inventory:byTenant(orders.inventory,tenantId),agreements:byTenant(orders.agreements,tenantId),audit:byTenant(orders.audit,tenantId),publishedOrderIds:orders.publishedOrderIds.filter(id=>tenantOrderIds.has(id))}}
}
function buildGateway(state:CommerceRuntimeState){const commercialRepositories=createSampleRepositories(state.commercial);const orderRepositories=createSampleOrderRepositories(state.orders);const commercial=new CommercialApplication(commercialRepositories);const orders=new OrderApplication({tenants:commercialRepositories.tenants,customers:commercialRepositories.customers,opportunities:commercialRepositories.opportunities,activities:commercialRepositories.activities,...orderRepositories});return new CommerceGateway(commercial,orders,orderRepositories.commerce)}
const MUTATIONS=new Set<CommerceGatewayRequest['operation']>(['createOrUpdateCustomer','createOpportunity','createOrderDraft','attachPaymentProof'])
export class PersistentCommerceRuntime {
 constructor(private readonly store:CommerceStateStore,private readonly maxAttempts=4){}
 async execute(request:CommerceGatewayRequest):Promise<unknown>{
  for(let attempt=1;attempt<=this.maxAttempts;attempt+=1){const loaded=await this.store.load(request.tenantId);const state=loaded?.state??createTenantCommerceState(request.tenantId);const result=await buildGateway(state).execute(request);if(!MUTATIONS.has(request.operation))return result;try{await this.store.save(request.tenantId,state,loaded?.version??null);return result}catch(error){if(!(error instanceof CommerceStateConflictError)||attempt===this.maxAttempts)throw error}}
  throw new Error('Commerce runtime retry limit reached')
 }
}
export class MemoryCommerceStateStore implements CommerceStateStore {
 private readonly records=new Map<string,{state:CommerceRuntimeState;version:number}>()
 async load(tenantId:string){const record=this.records.get(tenantId);return record?{state:structuredClone(record.state),version:String(record.version)}:null}
 async save(tenantId:string,state:CommerceRuntimeState,expectedVersion:string|null){const current=this.records.get(tenantId);if((current?String(current.version):null)!==expectedVersion)throw new CommerceStateConflictError();const version=(current?.version??0)+1;this.records.set(tenantId,{state:structuredClone(state),version});return String(version)}
}
