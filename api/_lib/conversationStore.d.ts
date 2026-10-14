export interface ConversationStorageRecord { id: string; data: Record<string, string>; version?: string }
export interface ConversationStorage {
  get?(id: string): Promise<ConversationStorageRecord | null>
  commit?(writes: Array<{ id: string; data: Record<string, unknown>; version?: string }>): Promise<boolean>
  query?(tenantId: string, options: { filters?: Array<{field:string;value:string|string[];op?:string}>;orderBy?:string;limit?:number;cursor?:{at:string;id:string} }): Promise<Array<Record<string,string>>>
}
export class ConversationError extends Error { code: string; status: number; constructor(code: string, status?: number) }
export function conversationIdentity(tenantId:string,channel:string,externalId:string):string
export function channelConversationIdentity(tenantId:string,provider:string,channel:string,externalConversationId:string):string
export function channelInboundId(tenantId:string,provider:string,channel:string,providerMessageId:string):string
export function conversationMetaId(conversationId:string):string
export function readConversation(tenantId:string,conversationId:string,overrides?:ConversationStorage):Promise<Record<string,string>|null>
export function updateConversation(tenantId:string,conversationId:string,transform:(current:Record<string,string>|null)=>Record<string,unknown>|null,overrides?:ConversationStorage):Promise<Record<string,string>|null>
export function getConversationDeliveryContext(input:{tenantId:string;conversationId:string},overrides?:ConversationStorage):Promise<{tenantId:string;conversationId:string;channel:string;recipient:string;phoneNumberId:string;lastCustomerMessageAt:string}|null>
export function recordInboundConversation(message:Record<string,string>,inboundId:string,overrides?:ConversationStorage):Promise<Record<string,string>>
export function recordChannelInboundConversation(message:Record<string,string>,inboundId:string,customerId:string,overrides?:ConversationStorage):Promise<{conversationId:string;customerId:string;inboundId:string;duplicate:boolean}>
export type ChannelOutboxStatus = 'NOT_SENT' | 'CLAIMED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN' | 'BLOCKED'
export interface ChannelOutboxRecord extends Record<string,string> { id:string; tenantId:string; conversationId:string; customerId:string; status:ChannelOutboxStatus; claimId?:string; leaseUntil?:string; outboundId:string }
export function recordChannelOutboundMessage(message:Record<string,string>,overrides?:ConversationStorage):Promise<{conversationId:string;customerId:string;messageId:string;outboundId:string;outboxId:string;status:ChannelOutboxStatus;duplicate:boolean}>
export function listChannelOutbox(tenantId:string,options?:{limit?:number;now?:string},overrides?:ConversationStorage):Promise<ChannelOutboxRecord[]>
export function claimChannelOutbox(tenantId:string,outboxId:string,workerId:string,options?:{leaseMs?:number;now?:number},overrides?:ConversationStorage):Promise<(ChannelOutboxRecord & {claimId:string})|null>
export function markChannelOutboxSending(tenantId:string,outboxId:string,claimId:string,overrides?:ConversationStorage):Promise<ChannelOutboxRecord>
export function finishChannelOutbox(tenantId:string,outboxId:string,claimId:string,result:{status:'SENT'|'FAILED'|'UNKNOWN'|'BLOCKED';providerMessageId?:string;code?:string},overrides?:ConversationStorage):Promise<ChannelOutboxRecord>
export function reconcileChannelOutbox(tenantId:string,options?:{now?:string;limit?:number},overrides?:ConversationStorage):Promise<ChannelOutboxRecord[]>
export function dispatchChannelOutboxOnce(input:{tenantId:string;workerId:string;transport:(item:{tenantId:string;provider:string;channel:string;conversationId:string;customerId:string;externalCustomerId:string;lastInboundAt:string;text:string;idempotencyKey:string;outboxId:string})=>Promise<{status:'SENT'|'FAILED'|'UNKNOWN'|'BLOCKED';providerMessageId?:string;code?:string}>;limit?:number;store?:ConversationStorage;now?:number}):Promise<Array<{id:string;status:string;code?:string}>>
export function changeConversationControl(tenantId:string,conversationId:string,action:string,actor:string,input:{idempotencyKey:string;reason?:string},overrides?:ConversationStorage):Promise<{ok:true;conversationId:string;mode:string;status:string;correlationId:string}>
