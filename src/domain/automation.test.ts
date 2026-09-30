import { describe,expect,it } from 'vitest'
import type { AutomationDefinition,AutomationEvent,OutboxEvent } from './automation.js'
import { completeOutbox,failOutbox,matchesAutomation,startOutbox } from './automation.js'
const def:AutomationDefinition={id:'a',tenantId:'t',name:'x',status:'ACTIVE',trigger:{type:'ORDER_CREATED'},conditions:[{field:'amount',operator:'GTE',value:100}],actions:[{type:'CREATE_FOLLOW_UP'}]}
const event:AutomationEvent={id:'e',tenantId:'t',type:'ORDER_CREATED',occurredAt:'x',entityType:'ORDER',entityId:'o',data:{amount:120}}
const out:OutboxEvent={id:'o',tenantId:'t',automationId:'a',sourceEventId:'e',actionType:'CREATE_FOLLOW_UP',status:'PENDING',payload:{kind:'FOLLOW_UP',customerId:'c',title:'x'},attempts:0,maxAttempts:2,availableAt:'x',createdAt:'x',updatedAt:'x'}
describe('H4 automation domain',()=>{
 it('matches trigger and conditions',()=>expect(matchesAutomation(def,event)).toBe(true))
 it('rejects another tenant',()=>expect(matchesAutomation(def,{...event,tenantId:'other'})).toBe(false))
 it('rejects paused definitions',()=>expect(matchesAutomation({...def,status:'PAUSED'},event)).toBe(false))
 it('evaluates numeric condition',()=>expect(matchesAutomation(def,{...event,data:{amount:99}})).toBe(false))
 it('starts an outbox attempt',()=>expect(startOutbox(out,'y')).toMatchObject({status:'PROCESSING',attempts:1}))
 it('completes processing outbox',()=>expect(completeOutbox(startOutbox(out,'y'),'z').status).toBe('SENT'))
 it('marks retryable failure',()=>expect(failOutbox(startOutbox(out,'y'),'z','x').status).toBe('FAILED'))
 it('dead letters at limit',()=>expect(failOutbox(startOutbox({...out,attempts:1},'y'),'z','x').status).toBe('DEAD_LETTER'))
})
