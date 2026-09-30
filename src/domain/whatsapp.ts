import type { EntityId, TenantScoped } from './shared.js'

export type WhatsAppConnectionStatus = 'DISCONNECTED' | 'CONFIGURED' | 'ACTIVE' | 'ERROR'
export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND'
export type WhatsAppMessageStatus = 'RECEIVED' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

export interface WhatsAppConnection extends TenantScoped {
  id: EntityId
  phoneNumberId: string
  businessAccountId?: string
  displayPhone?: string
  status: WhatsAppConnectionStatus
  createdAt: string
  updatedAt: string
}

export interface WhatsAppInboundMessage {
  providerMessageId: string
  phoneNumberId: string
  from: string
  customerName?: string
  text: string
  receivedAt: string
}

export interface WhatsAppMessage extends TenantScoped {
  id: EntityId
  providerMessageId?: string
  conversationId: EntityId
  customerId: EntityId
  externalCustomerId: string
  direction: WhatsAppMessageDirection
  status: WhatsAppMessageStatus
  text: string
  createdAt: string
  updatedAt: string
  error?: string
}

export interface WhatsAppProcessResult {
  duplicate: boolean
  tenantId?: string
  customerId?: string
  conversationId?: string
  reply?: string
  outboundMessageId?: string
  ignored?: boolean
  reason?: string
}

export interface MetaWebhookPayload {
  object?: string
  entry?: Array<{
    id?: string
    changes?: Array<{
      field?: string
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string }
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
        messages?: Array<{
          from?: string
          id?: string
          timestamp?: string
          type?: string
          text?: { body?: string }
        }>
        statuses?: Array<{
          id?: string
          status?: string
          timestamp?: string
          recipient_id?: string
        }>
      }
    }>
  }>
}

export function normalizeWhatsAppId(value:string):string {
  return value.replace(/[^\d]/g,'')
}

export function extractInboundTextMessages(payload:MetaWebhookPayload):WhatsAppInboundMessage[] {
  const result:WhatsAppInboundMessage[]=[]
  for(const entry of payload.entry??[]) for(const change of entry.changes??[]) {
    const value=change.value
    const phoneNumberId=value?.metadata?.phone_number_id
    if(!phoneNumberId) continue
    for(const message of value?.messages??[]) {
      const text=message.text?.body?.trim()
      if(message.type!=='text'||!message.id||!message.from||!text) continue
      const contact=value?.contacts?.find(c=>normalizeWhatsAppId(c.wa_id??'')===normalizeWhatsAppId(message.from??''))
      const epoch=Number(message.timestamp)
      result.push({
        providerMessageId:message.id,
        phoneNumberId,
        from:normalizeWhatsAppId(message.from),
        customerName:contact?.profile?.name,
        text,
        receivedAt:Number.isFinite(epoch)&&epoch>0?new Date(epoch*1000).toISOString():new Date(0).toISOString(),
      })
    }
  }
  return result
}

export function verifyWebhookChallenge(mode:string|null,token:string|null,challenge:string|null,expectedToken:string):string|null {
  return mode==='subscribe'&&token===expectedToken&&challenge?challenge:null
}
