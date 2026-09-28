import { describe,expect,it } from 'vitest'
import { createSampleRepositories } from '../adapters/memory/commercialRepositories'
import { createSampleOrderRepositories } from '../adapters/memory/orderRepositories'
import { SupervisorApplication } from './supervisor'

const setup=()=>{const commercial=createSampleRepositories();const orders=createSampleOrderRepositories();return new SupervisorApplication({...commercial,orders:orders.orders,proofs:orders.proofs},()=> '2026-09-28T15:00:00.000Z')}
describe('H5 Supervisor and human escalation',()=>{
 it('creates durable-style escalation data without approving payments',async()=>{const app=setup();const e=await app.escalate({tenantId:'tenant-mg',conversationId:'conv-mg-1',reason:'COMPLAINT'});expect(e).toMatchObject({reason:'COMPLAINT',status:'OPEN',priority:'HIGH'});const snap=await app.snapshot('tenant-mg');expect(snap.humanQueue.some(x=>x.escalationId===e.id&&x.state==='COMPLAINT')).toBe(true)})
 it('is idempotent for the same open reason and conversation',async()=>{const app=setup();const a=await app.escalate({tenantId:'tenant-mg',conversationId:'conv-mg-1',reason:'CUSTOMER_REQUEST'});const b=await app.escalate({tenantId:'tenant-mg',conversationId:'conv-mg-1',reason:'CUSTOMER_REQUEST'});expect(b.id).toBe(a.id)})
 it('isolates tenant snapshots',async()=>{const app=setup();const snap=await app.snapshot('tenant-floes');expect(snap.cases.every(x=>x.tenantId==='tenant-floes')).toBe(true)})
})
