import { describe,expect,it } from 'vitest'
import { evaluateAutomationAction,type AutomationPolicy } from './policy.js'
const p:AutomationPolicy={tenantId:'t',autonomyLevel:2,allowMessageRequests:true,allowFollowUps:true,allowRepurchase:true,allowEscalations:true}
describe('H4 policy',()=>{
 it('allows message request at L2',()=>expect(evaluateAutomationAction(p,'SEND_MESSAGE_REQUEST')).toBe('ALLOWED'))
 it('never lets L0 automate',()=>expect(evaluateAutomationAction({...p,autonomyLevel:0},'CREATE_FOLLOW_UP')).toBe('DENIED'))
 it('requires human at L1',()=>expect(evaluateAutomationAction({...p,autonomyLevel:1},'SEND_MESSAGE_REQUEST')).toBe('HUMAN_REQUIRED'))
 it('honors disabled followups',()=>expect(evaluateAutomationAction({...p,allowFollowUps:false},'CREATE_FOLLOW_UP')).toBe('DENIED'))
 it('honors disabled repurchase',()=>expect(evaluateAutomationAction({...p,allowRepurchase:false},'CREATE_REPURCHASE_OPPORTUNITY')).toBe('DENIED'))
 it('allows explicit escalation',()=>expect(evaluateAutomationAction(p,'REQUEST_HUMAN_ESCALATION')).toBe('ALLOWED'))
})
