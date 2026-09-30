import { describe,expect,it } from 'vitest'
import { createSampleRepositories } from '../adapters/memory/commercialRepositories.js'
import { createSampleOrderRepositories } from '../adapters/memory/orderRepositories.js'
import { SupervisorApplication } from './supervisor.js'

describe('H5 Supervisor gateway contract',()=>{
 it('returns an OPEN tenant-scoped escalation for GanoBot',async()=>{
  const commercial=createSampleRepositories();const orders=createSampleOrderRepositories()
  const app=new SupervisorApplication({...commercial,orders:orders.orders,proofs:orders.proofs},()=> '2026-09-28T16:00:00.000Z')
  const item=await app.escalate({tenantId:'tenant-floes',conversationId:'conv-fl-2',reason:'CUSTOMER_REQUEST',contextSummary:'Solicitó persona'})
  expect(item).toMatchObject({tenantId:'tenant-floes',conversationId:'conv-fl-2',reason:'CUSTOMER_REQUEST',status:'OPEN'})
 })
})
