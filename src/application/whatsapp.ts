import type { CustomerIdentity, MetaWebhookPayload, WhatsAppConnection, WhatsAppInboundMessage, WhatsAppMessage, WhatsAppProcessResult } from '../domain'
import { extractInboundTextMessages, normalizeWhatsAppId } from '../domain'
import type { CommercialRepositories } from './commercial'
import type { CommercialApplication } from './commercial'
import type { GanoBotApplication } from './ganobot'

export interface WhatsAppConnectionRepository {
  list(scope:string):Promise<readonly WhatsAppConnection[]>
  resolveByPhoneNumberId(phoneNumberId:string):Promise<WhatsAppConnection|null>
  save(item:WhatsAppConnection):Promise<void>
}
export interface WhatsAppMessageRepository {
  findInbound(providerMessageId:string):Promise<WhatsAppMessage|null>
  getByProviderMessageId(providerMessageId:string):Promise<WhatsAppMessage|null>
  list(scope:string):Promise<readonly WhatsAppMessage[]>
  save(item:WhatsAppMessage):Promise<void>
}
export interface WhatsAppChannelAdapter {
  sendText(input:{phoneNumberId:string;to:string;text:string}):Promise<{providerMessageId:string}>
}
export interface WhatsAppRepositories {
  connections:WhatsAppConnectionRepository
  messages:WhatsAppMessageRepository
}
export class WhatsAppApplication {
  private sequence=1000
  constructor(
    private commercial:CommercialApplication,
    private commercialRepos:CommercialRepositories,
    private ganobot:GanoBotApplication,
    private repos:WhatsAppRepositories,
    private channel:WhatsAppChannelAdapter,
    private clock:()=>string=()=>new Date().toISOString(),
  ){}
  private id(prefix:string){this.sequence+=1;return `${prefix}-${this.sequence}`}
  listConnections(scope:string){return this.repos.connections.list(scope)}
  listMessages(scope:string){return this.repos.messages.list(scope)}

  async ingestWebhook(payload:MetaWebhookPayload):Promise<WhatsAppProcessResult[]> {
    const messages=extractInboundTextMessages(payload)
    const results:WhatsAppProcessResult[]=[]
    for(const message of messages) results.push(await this.ingest(message))
    return results
  }

  async ingest(input:WhatsAppInboundMessage):Promise<WhatsAppProcessResult> {
    const duplicate=await this.repos.messages.findInbound(input.providerMessageId)
    if(duplicate)return{duplicate:true,tenantId:duplicate.tenantId,customerId:duplicate.customerId,conversationId:duplicate.conversationId}
    const connection=await this.repos.connections.resolveByPhoneNumberId(input.phoneNumberId)
    if(!connection||connection.status!=='ACTIVE')return{duplicate:false,ignored:true,reason:'Unknown or inactive WhatsApp phone_number_id'}
    const tenantId=connection.tenantId
    const externalId=normalizeWhatsAppId(input.from)
    let identity=await this.commercialRepos.identities.resolve(tenantId,'WHATSAPP',externalId)
    let customerId:string
    if(identity) customerId=identity.customerId
    else {
      const customer=await this.commercial.createCustomer({tenantId,name:input.customerName?.trim()||`WhatsApp ${externalId.slice(-4)}`,phone:`+${externalId}`,status:'LEAD',acquisitionSource:'WhatsApp',tags:['whatsapp']})
      customerId=customer.id
      identity={id:this.id('wa-identity'),tenantId,customerId,channel:'WHATSAPP',externalIdentifier:externalId,createdAt:this.clock()} satisfies CustomerIdentity
      await this.commercialRepos.identities.save(tenantId,identity)
    }
    const existing=(await this.commercialRepos.conversations.listByTenant(tenantId,{channel:'WHATSAPP'}))
      .filter(c=>c.customerId===customerId&&c.status!=='CLOSED')
      .sort((a,b)=>b.lastActivityAt.localeCompare(a.lastActivityAt))[0]
    const conversation=existing??await this.commercial.startConversation({tenantId,customerId,channel:'WHATSAPP',assignedMode:'AUTOMATION'})
    const now=this.clock()
    const inbound:WhatsAppMessage={id:this.id('wa-msg'),tenantId,providerMessageId:input.providerMessageId,conversationId:conversation.id,customerId,externalCustomerId:externalId,direction:'INBOUND',status:'RECEIVED',text:input.text,createdAt:now,updatedAt:now}
    await this.repos.messages.save(inbound)

    const reply=await this.ganobot.handle({tenantId,customerId,conversationId:conversation.id,channel:'WHATSAPP',text:input.text,actor:{actorId:'whatsapp-ingress',role:'AUTOMATION',tenantId}})
    const queued:WhatsAppMessage={id:this.id('wa-msg'),tenantId,conversationId:conversation.id,customerId,externalCustomerId:externalId,direction:'OUTBOUND',status:'QUEUED',text:reply.text,createdAt:this.clock(),updatedAt:this.clock()}
    await this.repos.messages.save(queued)
    try {
      const sent=await this.channel.sendText({phoneNumberId:connection.phoneNumberId,to:externalId,text:reply.text})
      const done={...queued,providerMessageId:sent.providerMessageId,status:'SENT' as const,updatedAt:this.clock()}
      await this.repos.messages.save(done)
      return{duplicate:false,tenantId,customerId,conversationId:conversation.id,reply:reply.text,outboundMessageId:done.id}
    } catch(cause) {
      const failed={...queued,status:'FAILED' as const,error:cause instanceof Error?cause.message:'WhatsApp send failed',updatedAt:this.clock()}
      await this.repos.messages.save(failed)
      return{duplicate:false,tenantId,customerId,conversationId:conversation.id,reply:reply.text,outboundMessageId:failed.id}
    }
  }
}

export class MetaCloudWhatsAppAdapter implements WhatsAppChannelAdapter {
  constructor(private accessToken:string,private graphVersion='v23.0',private fetcher:typeof fetch=fetch){}
  async sendText(input:{phoneNumberId:string;to:string;text:string}){
    const response=await this.fetcher(`https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(input.phoneNumberId)}/messages`,{
      method:'POST',
      headers:{Authorization:`Bearer ${this.accessToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:input.to,type:'text',text:{preview_url:false,body:input.text}}),
    })
    if(!response.ok)throw new Error(`Meta send failed (${response.status})`)
    const body=await response.json() as {messages?:Array<{id?:string}>}
    const id=body.messages?.[0]?.id
    if(!id)throw new Error('Meta response missing message id')
    return{providerMessageId:id}
  }
}
