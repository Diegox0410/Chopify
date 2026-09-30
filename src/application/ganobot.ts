import type { ActorContext, CommerceProduct, GanoBotInbound, GanoBotReply, GanoBotSession, GanoBotToolName, GanoBotToolTrace, OrderItemRequest } from '../domain/index.js'
import { classifyGanoBotIntent, ganobotToolPolicy } from '../domain/index.js'
import type { BusinessCommerceAdapter } from './commercePort.js'
import type { CommercialApplication } from './commercial.js'
import type { OrderApplication } from './orders.js'

export interface GanoBotSessionRepository { get(tenantId:string,conversationId:string):Promise<GanoBotSession|null>; save(item:GanoBotSession):Promise<void>; list(scope:string):Promise<readonly GanoBotSession[]> }
export interface GanoBotTraceRepository { append(item:GanoBotToolTrace):Promise<void>; list(scope:string):Promise<readonly GanoBotToolTrace[]> }
export class GanoBotApplication {
 private sequence=900
 constructor(private commercial:CommercialApplication,private orders:OrderApplication,private commerce:BusinessCommerceAdapter,private sessions:GanoBotSessionRepository,private traces:GanoBotTraceRepository,private clock:()=>string=()=>new Date().toISOString()){}
 private id(p:string){this.sequence++;return`${p}-${this.sequence}`}
 private automationActor(tenantId:string):ActorContext{return{actorId:'ganobot',role:'AUTOMATION',tenantId}}
 private async trace(sessionId:string,tenantId:string,tool:GanoBotToolName,status:GanoBotToolTrace['status'],summary:string){const t={id:this.id('gbtrace'),tenantId,sessionId,tool,status,summary,createdAt:this.clock()};await this.traces.append(t);return t}
 private async session(input:GanoBotInbound){let s=await this.sessions.get(input.tenantId,input.conversationId);if(s)return s;const now=this.clock();s={id:this.id('gbs'),tenantId:input.tenantId,customerId:input.customerId,conversationId:input.conversationId,channel:input.channel,messages:[],lastIntent:'UNKNOWN',createdAt:now,updatedAt:now};await this.sessions.save(s);return s}
 async listSessions(scope:string){return this.sessions.list(scope)} async listTraces(scope:string){return this.traces.list(scope)}
 async handle(input:GanoBotInbound):Promise<GanoBotReply>{
  if(input.actor.role!=='PLATFORM_OWNER'&&input.actor.tenantId!==input.tenantId)throw new Error('Actor tenant mismatch')
  let s=await this.session(input);const intent=classifyGanoBotIntent(input.text);const now=this.clock();let text:string;let products:readonly CommerceProduct[]|undefined;const used:GanoBotToolTrace[]=[]
  const run=async(tool:GanoBotToolName,summary:string)=>{const policy=ganobotToolPolicy(tool);const status=policy==='HUMAN_REQUIRED'?'HUMAN_REQUIRED':'SUCCEEDED';const t=await this.trace(s.id,input.tenantId,tool,status,summary);used.push(t);return policy}
  if(intent==='HUMAN_REQUEST'){await run('REQUEST_HUMAN','Cliente solicitó atención humana');await this.commercial.requireHumanConversation(input.tenantId,input.conversationId);text='He marcado esta conversación para atención humana.'}
  else if(intent==='ORDER_STATUS'&&s.orderId){await run('GET_ORDER_STATUS',`Consulta ${s.orderId}`);const order=await this.orders.getOrder(input.tenantId,s.orderId);text=order?`Tu pedido ${order.id} está ${order.orderStatus}; pago ${order.paymentStatus}; entrega ${order.fulfillmentStatus}.`:'No encontré ese pedido en este negocio.'}
  else {
   const query=this.productQuery(input.text);products=await this.commerce.searchProducts(input.tenantId,query);await run('SEARCH_PRODUCTS',`Búsqueda: ${query||'catálogo'}`)
   let selected=products[0]??(s.selectedProductId?await this.commerce.getProduct(input.tenantId,s.selectedProductId):null)
   if(!selected&&query){products=await this.commerce.searchProducts(input.tenantId,'');selected=products[0]??null}
   if(intent==='PURCHASE_INTENT'&&selected&&selected.pricingStatus==='READY'&&selected.salePriceCents!==null&&selected.variants.length===0){
    const opportunity=await this.ensureOpportunity(s,input,selected);s={...s,opportunityId:opportunity.id,selectedProductId:selected.id};await run('CREATE_OPPORTUNITY',`Oportunidad ${opportunity.id}`)
    let current=opportunity;if(current.status==='OPEN')current=await this.commercial.qualifyOpportunity(input.tenantId,current.id);if(current.status==='QUALIFIED')current=await this.commercial.startOpportunityCart(input.tenantId,current.id);if(current.status==='CART_STARTED')current=await this.commercial.markOpportunityOrderCreated(input.tenantId,current.id)
    const item:OrderItemRequest={productId:selected.id,quantity:1};const order=await this.orders.createOrderFromOpportunity({tenantId:input.tenantId,opportunityId:current.id,items:[item],managed:true,managedBy:'AUTOMATION',idempotencyKey:`ganobot:${input.conversationId}:${current.id}`,actor:this.automationActor(input.tenantId)});s={...s,orderId:order.id};await run('CREATE_ORDER',`Pedido ${order.id}`);text=`Pedido ${order.id} creado por ${this.money(order.grandTotalCents,order.currency)}. El pago sigue ${order.paymentStatus}; GanoBot no confirma pagos.`
   } else if(selected){s={...s,selectedProductId:selected.id};await run('GET_PRODUCT',selected.name);const available=await this.commerce.getAvailability(input.tenantId,selected.id);await run('GET_AVAILABILITY',`${selected.id}: ${available}`);const price=selected.salePriceCents===null?'El precio está pendiente de confirmación.':this.money(selected.salePriceCents,selected.currency);const colors=selected.variants.map((variant)=>variant.color).filter((color):color is string=>Boolean(color));text=`${selected.name}: ${price}${colors.length?` Colores: ${colors.join(', ')}.`:''} ${selected.fulfillmentMode==='MADE_TO_ORDER'?'Se gestiona bajo pedido.':''}`.trim()}
   else text='No encontré un producto verificable en el catálogo de este negocio. No voy a inventar precio ni stock.'
  }
  s={...s,lastIntent:intent,messages:[...s.messages,{role:'CUSTOMER',text:input.text,at:now},{role:'ASSISTANT',text,at:this.clock()}],updatedAt:this.clock()};await this.sessions.save(s);return{text,intent,tools:used,session:s,products}
 }
 private productQuery(text:string){const q=text.toLocaleLowerCase();if(/mar[ií]a jos[eé].*chaqueta|chaqueta/.test(q))return'Chaqueta María José';if(/mar[ií]a jos[eé]/.test(q))return'Scrub María José';if(/mar[ií]a bel[eé]n/.test(q))return'Scrub María Belén';if(/esencial|b[aá]sico|colores/.test(q))return'Scrub Esencial';if(/scrub|uniforme|producto|modelo/.test(q))return'';return''}
 private money(cents:number,currency:string){return new Intl.NumberFormat('es-EC',{style:'currency',currency:currency==='COP'?'USD':currency}).format(cents/100)}
 private async ensureOpportunity(s:GanoBotSession,input:GanoBotInbound,p:CommerceProduct){if(s.opportunityId){const found=await this.commercial.getOpportunity(input.tenantId,s.opportunityId);if(found&&!['WON','LOST','ABANDONED'].includes(found.status))return found}if(p.salePriceCents===null)throw new Error('Product pricing is pending');return this.commercial.createOpportunity({tenantId:input.tenantId,customerId:input.customerId,conversationId:input.conversationId,intent:'PURCHASE_INTENT',estimatedValueCents:p.salePriceCents,currency:p.currency,acquisitionSource:input.channel,conversionChannel:input.channel,assignedTo:'ganobot'})}
}
