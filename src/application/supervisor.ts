import type { CommercialRepositories } from './commercial.js'
import type { OrderRepository, PaymentProofRepository } from '../repositories/contracts.js'
import type { HumanEscalation } from '../domain/index.js'
import { classifySupervisorCase, supervisorCounts, type SupervisorSnapshot } from '../domain/supervisor.js'

export interface SupervisorRepositories extends CommercialRepositories { orders:OrderRepository; proofs:PaymentProofRepository }

export class SupervisorApplication {
  private sequence=0
  constructor(private readonly repositories:SupervisorRepositories,private readonly clock:()=>string=()=>new Date().toISOString()){}
  private id(){this.sequence+=1;const uuid=globalThis.crypto?.randomUUID?.();return uuid?`escalation-${uuid}`:`escalation-${Date.now()}-${this.sequence}`}
  async escalate(input:{tenantId:string;conversationId:string;reason:HumanEscalation['reason'];priority?:HumanEscalation['priority'];contextSummary?:string;orderId?:string}){
    const conversation=await this.repositories.conversations.getById(input.tenantId,input.conversationId);if(!conversation)throw new Error('Conversation not found in tenant')
    const open=await this.repositories.escalations.listOpen(input.tenantId);const duplicate=open.find(x=>x.conversationId===input.conversationId&&x.reason===input.reason)
    if(duplicate)return duplicate
    const escalation:HumanEscalation={id:this.id(),tenantId:input.tenantId,customerId:conversation.customerId,conversationId:conversation.id,orderId:input.orderId,reason:input.reason,priority:input.priority??(input.reason==='COMPLAINT'||input.reason==='PAYMENT_ISSUE'?'HIGH':'NORMAL'),status:'OPEN',contextSummary:input.contextSummary,createdAt:this.clock()}
    await this.repositories.escalations.save(input.tenantId,escalation)
    await this.repositories.conversations.save(input.tenantId,{...conversation,status:'HUMAN_REQUIRED',assignedMode:'AUTOMATION',assignedUserId:undefined,updatedAt:this.clock(),lastActivityAt:this.clock()})
    return escalation
  }
  async resolve(tenantId:string,escalationId:string){
    const open=await this.repositories.escalations.listOpen(tenantId);const item=open.find(x=>x.id===escalationId);if(!item)throw new Error('Open escalation not found in tenant')
    const next={...item,status:'RESOLVED' as const,resolvedAt:this.clock()};await this.repositories.escalations.save(tenantId,next);return next
  }
  async snapshot(tenantId:string):Promise<SupervisorSnapshot>{
    const [conversations,escalations,orders,proofs]=await Promise.all([this.repositories.conversations.listByTenant(tenantId),this.repositories.escalations.listOpen(tenantId),this.repositories.orders.listByTenant(tenantId),this.repositories.proofs.listByTenant(tenantId)])
    const cases=conversations.map(conversation=>{const escalation=escalations.find(x=>x.conversationId===conversation.id);const order=orders.find(x=>x.customerId===conversation.customerId);const proof=order?proofs.find(x=>x.orderId===order.id):undefined;return classifySupervisorCase({conversation,escalation,order,proof})})
    const rank={URGENT:4,HIGH:3,NORMAL:2,LOW:1};const humanQueue=cases.filter(x=>x.needsHuman).sort((a,b)=>rank[b.priority]-rank[a.priority])
    return {tenantId,cases,humanQueue,counts:supervisorCounts(cases)}
  }
}
