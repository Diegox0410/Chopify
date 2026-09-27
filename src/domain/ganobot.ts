import type { ActorContext, Channel, CommerceProduct, OpportunityIntent } from './index'

export type GanoBotToolName = 'SEARCH_PRODUCTS' | 'GET_PRODUCT' | 'GET_AVAILABILITY' | 'CREATE_OPPORTUNITY' | 'CREATE_ORDER' | 'GET_ORDER_STATUS' | 'REQUEST_HUMAN'
export type GanoBotIntent = Extract<OpportunityIntent, 'PRODUCT_DISCOVERY' | 'PRODUCT_QUESTION' | 'PRICE_CHECK' | 'AVAILABILITY_CHECK' | 'PURCHASE_INTENT' | 'ORDER_STATUS' | 'HUMAN_REQUEST' | 'UNKNOWN'>
export interface GanoBotMessage { role:'CUSTOMER'|'ASSISTANT'|'SYSTEM'; text:string; at:string }
export interface GanoBotSession { id:string; tenantId:string; customerId:string; conversationId:string; channel:Channel; messages:readonly GanoBotMessage[]; lastIntent:GanoBotIntent; selectedProductId?:string; opportunityId?:string; orderId?:string; createdAt:string; updatedAt:string }
export interface GanoBotToolTrace { id:string; tenantId:string; sessionId:string; tool:GanoBotToolName; status:'SUCCEEDED'|'DENIED'|'HUMAN_REQUIRED'|'FAILED'; summary:string; createdAt:string }
export interface GanoBotReply { text:string; intent:GanoBotIntent; tools:readonly GanoBotToolTrace[]; session:GanoBotSession; products?:readonly CommerceProduct[] }
export interface GanoBotInbound { tenantId:string; customerId:string; conversationId:string; channel:Channel; text:string; actor:ActorContext }
export function classifyGanoBotIntent(text:string):GanoBotIntent { const q=text.toLocaleLowerCase(); if(/humano|asesor|persona/.test(q))return'HUMAN_REQUEST'; if(/estado|pedido|orden/.test(q))return'ORDER_STATUS'; if(/comprar|quiero|llevar|pedido/.test(q))return'PURCHASE_INTENT'; if(/stock|disponib|hay\s/.test(q))return'AVAILABILITY_CHECK'; if(/precio|cuesta|valor/.test(q))return'PRICE_CHECK'; if(/producto|cat[aá]logo|modelo|scrub|uniforme|kit|pack|pieza|colecci[oó]n/.test(q))return'PRODUCT_DISCOVERY'; return'UNKNOWN' }
export function ganobotToolPolicy(tool:GanoBotToolName):'ALLOWED'|'HUMAN_REQUIRED' { return tool==='REQUEST_HUMAN'?'HUMAN_REQUIRED':'ALLOWED' }
