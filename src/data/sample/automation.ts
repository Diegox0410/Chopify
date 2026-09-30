import type { AutomationDefinition, AutomationPolicy, OutboxEvent } from '../../domain/index.js'
const rules = (tenantId:string, prefix:string): AutomationDefinition[] => [
 { id:`auto-${prefix}-paid`, tenantId, name:'Seguimiento después del pago', status:'ACTIVE', trigger:{type:'PAYMENT_CONFIRMED'}, conditions:[], actions:[{type:'CREATE_FOLLOW_UP',config:{title:'Confirmar preparación del pedido'}},{type:'SEND_MESSAGE_REQUEST',config:{templateKey:'payment_confirmed'}}] },
 { id:`auto-${prefix}-delivered`, tenantId, name:'Postventa de pedido entregado', status:'ACTIVE', trigger:{type:'ORDER_DELIVERED'}, conditions:[], actions:[{type:'CREATE_FOLLOW_UP',config:{title:'Seguimiento postventa'}},{type:'SEND_MESSAGE_REQUEST',config:{templateKey:'post_sale'}}] },
 { id:`auto-${prefix}-repurchase`, tenantId, name:'Ventana de recompra', status:'ACTIVE', trigger:{type:'REPURCHASE_WINDOW_REACHED'}, conditions:[], actions:[{type:'CREATE_REPURCHASE_OPPORTUNITY',config:{title:'Revisar recompra'}},{type:'SEND_MESSAGE_REQUEST',config:{templateKey:'repurchase'}}] },
]
export const sampleAutomations: readonly AutomationDefinition[] = [...rules('tenant-mg','mg'),...rules('tenant-dgng','dg'),...rules('tenant-floes','fl')]
export const sampleAutomationPolicies: readonly AutomationPolicy[] = [
 {tenantId:'tenant-mg',autonomyLevel:2,allowMessageRequests:true,allowFollowUps:true,allowRepurchase:true,allowEscalations:true},
 {tenantId:'tenant-dgng',autonomyLevel:2,allowMessageRequests:true,allowFollowUps:true,allowRepurchase:true,allowEscalations:true},
 {tenantId:'tenant-floes',autonomyLevel:2,allowMessageRequests:true,allowFollowUps:true,allowRepurchase:true,allowEscalations:true},
]
export const sampleOutbox: readonly OutboxEvent[] = []
