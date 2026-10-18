import { createHash } from 'node:crypto'
import { queryLiveDocuments } from './live.js'
import { ConversationError, conversationIdentity, readConversation } from './conversationStore.js'

const masked = value => String(value || '').replace(/\D/g, '').length >= 4 ? `**** ${String(value).replace(/\D/g, '').slice(-4)}` : 'Sin teléfono'
const timestamp = item => item.createdAt || item.receivedAt || item.sentAt || ''
const safeImage = value => {
  try { const url = new URL(value); const origin = new URL(process.env.FLOES_PUBLIC_BASE_URL || 'https://www.floes-ec.com').origin
    return url.protocol === 'https:' && url.origin === origin && url.pathname.startsWith('/catalogo/floes/') && !url.username && !url.password && !url.search && !url.hash ? url.href : null
  } catch { return null }
}
export function messageEvent(item, conversationId, proofLinks = []) {
  const direction = item.id.startsWith('in_') ? 'INBOUND' : item.id.startsWith('out_') ? 'OUTBOUND' : 'EVENT'
  const attachments = []
  if (item.paymentProofReference) { const proof = proofLinks.find(row => row.fileReference === item.paymentProofReference); attachments.push({type:'PAYMENT_PROOF',private:true,...(proof ? {orderId:proof.orderId,proofId:proof.id} : {})}) }
  let messages = []
  try { const parsed = JSON.parse(item.messagesJson || '[]'); if (Array.isArray(parsed)) messages = parsed } catch { /* legacy text remains visible */ }
  for (const message of messages) {
    if (message.type === 'image') { const url = safeImage(message.url); if (url) attachments.push({ type: 'IMAGE', url, caption: String(message.caption || '').slice(0, 1024), private: false }) }
  }
  const text = [...new Set([item.text, ...messages.filter(message => message.type === 'text').map(message => message.text)].filter(value => typeof value === 'string' && value.trim()))].join('\n')
  return {
    id: item.id, conversationId, direction, senderType: direction === 'INBOUND' ? 'CLIENT' : direction === 'EVENT' || item.senderType === 'SYSTEM' ? 'SYSTEM' : item.senderType === 'HUMAN' || item.mode === 'HUMAN' ? 'HUMAN' : 'GANOBOT',
    createdAt: timestamp(item), text, status: item.status || 'RECEIVED', attachments,
    deliveryStatus: ['SENT', 'READ', 'DELIVERED', 'FAILED'].includes(item.deliveryStatus) ? item.deliveryStatus : item.status === 'SENT' ? 'ACCEPTED' : null,
    ...(item.correlationId ? { correlationId: item.correlationId } : {}),
    ...(direction === 'EVENT' ? { action: item.action || '', actor: item.actor || '', reason: item.reason || '' } : {}),
    ...(item.technicalReason ? { technicalReason: item.technicalReason } : {}),
  }
}
export function conversationSelection(thread) {
  try {const value=JSON.parse(thread.currentSelectionJson || '{}'); return /^[\w:.-]{1,128}$/.test(value.productId||'') ? {productId:value.productId,...(['variantId','color','size'].reduce((result,key)=>{if(typeof value[key]==='string'&&value[key].length<=100)result[key]=value[key];return result},{}))} : null} catch{return null}
}
const publicCommerceContext = context => ({orders:context.orders||[],payments:context.payments||[],activities:context.activities||[],notes:context.notes||[],opportunities:context.opportunities||[],escalations:context.escalations||[],productInterests:context.productInterests||[],proofs:(context.proofLinks||[]).map(proof=>({id:proof.id,orderId:proof.orderId,status:proof.status,submittedAt:proof.submittedAt}))})
export function conversationSummary(thread) {
  return {
    id: thread.conversationId, tenantId: thread.tenantId, customerId: thread.customerId || null,
    channel: thread.channel || 'WHATSAPP', contact: thread.contact || masked(thread.externalCustomerId), maskedPhone: masked(thread.externalCustomerId),
    origin: thread.origin || null, currentSelection: conversationSelection(thread), createdAt: thread.createdAt || '', lastActivityAt: thread.lastActivityAt || thread.lastInboundAt || '',
    status: thread.status || (thread.requiresHuman === 'true' ? 'REQUIRES_HUMAN' : 'AI_ATTENDING'), mode: thread.mode || 'GANOBOT_LIVE',
    requiresHuman: thread.requiresHuman === 'true', assignedTo: thread.assignedTo || null, unreadCount: Number(thread.unreadCount || 0),
    lastMessage: thread.lastText || '', closeReason: thread.closeReason || '',
    firstResponseAt: thread.firstResponseAt || null, firstResponseSeconds: thread.firstResponseAt && thread.createdAt ? Math.max(0, (Date.parse(thread.firstResponseAt) - Date.parse(thread.createdAt)) / 1000) : null,
  }
}
export function groupLegacyConversations(documents, tenantId) {
  const groups = new Map()
  for (const row of documents.filter(item => item.tenantId === tenantId && item.id.startsWith('in_') && (!item.channel || item.channel === 'WHATSAPP'))) {
    const id = row.conversationId || conversationIdentity(tenantId, 'WHATSAPP', row.from)
    const old = groups.get(id)
    if (!old || timestamp(row) > old.lastActivityAt) groups.set(id, {
      conversationId: id, tenantId, channel: row.channel || 'WHATSAPP', externalCustomerId: row.from,
      contact: row.name, lastActivityAt: timestamp(row), lastInboundAt: row.receivedAt, lastInboundId: row.id,
      lastText: row.text, phoneNumberId: row.phoneNumberId, createdAt: old?.createdAt || row.receivedAt,
      mode: ['NEEDS_HUMAN', 'HUMAN_QUEUED'].includes(row.status) ? 'HUMAN' : 'GANOBOT_LIVE',
      requiresHuman: ['NEEDS_HUMAN', 'HUMAN_QUEUED'].includes(row.status) ? 'true' : 'false',
      status: ['NEEDS_HUMAN', 'HUMAN_QUEUED'].includes(row.status) ? 'REQUIRES_HUMAN' : 'AI_ATTENDING',
      unreadCount: '0', escalationReason: row.escalationReason || '',
    })
  }
  return [...groups.values()]
}
export const encodeConversationCursor = value => Buffer.from(JSON.stringify(value)).toString('base64url')
export function decodeConversationCursor(value, tenantId, scope) {
  if (!value) return undefined
  try {
    if (typeof value !== 'string' || value.length > 1500) throw new Error()
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed.tenantId !== tenantId || parsed.scope !== scope || typeof parsed.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed.at) || !Number.isFinite(Date.parse(parsed.at)) || !/^[\w.-]{1,180}$/.test(parsed.id)) throw new Error()
    return { at: parsed.at, id: parsed.id }
  } catch { throw new ConversationError('INVALID_CURSOR', 400) }
}
const boundedLimit = value => Math.floor(Math.min(Math.max(Number(value) || 25, 1), 50))
export async function listConversationSummaries(tenantId, input = {}, overrides = {}) {
  const query = overrides.query || queryLiveDocuments
  const limit = boundedLimit(input.limit)
  const filters = [{ field: 'kind', value: 'THREAD' }]
  if (input.customerId) {
    if (typeof input.customerId !== 'string' || !/^[\w:.-]{1,128}$/.test(input.customerId)) throw new ConversationError('INVALID_CUSTOMER', 400)
    filters.push({ field: 'customerId', value: input.customerId })
  }
  const allowedStatuses = ['AI_ATTENDING','WAITING_CUSTOMER','WAITING_PAYMENT','PAYMENT_REVIEW','REQUIRES_HUMAN','HUMAN_ATTENDING','PREPARING','DISPATCHED','DELIVERED','POSTSALE','CLOSED']
  const allowedModes = ['HUMAN','GANOBOT_LIVE']
  if (input.status) {
    if (!allowedStatuses.includes(input.status) && !allowedModes.includes(input.status)) throw new ConversationError('INVALID_STATUS_FILTER', 400)
    filters.push({ field: allowedModes.includes(input.status) ? 'mode' : 'status', value: input.status })
  }
  if (input.channel) {
    // Keep this enum aligned with the channel values persisted by inbound intake
    // and the Owner UI. FACEBOOK is supported by the Meta channel adapter;
    // MESSENGER is not a persisted channel identifier in this system.
    if (!['WHATSAPP','INSTAGRAM','FACEBOOK','WEB','TIKTOK'].includes(input.channel)) throw new ConversationError('INVALID_CHANNEL_FILTER', 400)
    filters.push({ field: 'channel', value: input.channel })
  }
  const needle = String(input.query || '').trim().toLocaleLowerCase('es').slice(0,100)
  const scope = 'list:' + createHash('sha256').update(JSON.stringify({filters,needle})).digest('hex')
  const cursor = decodeConversationCursor(input.cursor, tenantId, scope)
  const rows = await query(tenantId, { filters, orderBy: 'lastActivityAt', limit: limit + 1, cursor })
  const sourcePage = rows.slice(0,limit)
  // Legacy supplementation is bounded and appears only on the first page. Keep
  // every indexed source row so a legacy row can never consume its cursor slot.
  // A separately authorized backfill is required for complete historical coverage.
  const legacy = !input.customerId && !cursor
    ? groupLegacyConversations(await query(tenantId,{orderBy:'receivedAt',limit:50}),tenantId).filter(row=>!sourcePage.some(indexed=>indexed.conversationId===row.conversationId))
    : []
  const summaries = [...sourcePage,...legacy].map(conversationSummary).sort((a,b)=>b.lastActivityAt.localeCompare(a.lastActivityAt)||b.id.localeCompare(a.id))
  const filtered = summaries.filter(row=>(!input.status || row.status===input.status || row.mode===input.status)
    &&(!input.channel || row.channel===input.channel)&&(!needle || (row.contact+' '+row.maskedPhone+' '+row.lastMessage).toLocaleLowerCase('es').includes(needle)))
  const last = sourcePage.at(-1)
  return {ok:true,conversations:filtered,
    ...(rows.length>limit&&last?{nextCursor:encodeConversationCursor({tenantId,scope,at:last.lastActivityAt,id:last.id})}:{}),
    coverage:legacy.length?'INDEXED_AND_RECENT_LEGACY':'INDEXED',
    legacyCoverage:!input.customerId&&!cursor?'RECENT_50_EVENTS_ONLY':'NOT_SCANNED', searchScope:'CURRENT_SOURCE_PAGE',
    metrics:{basis:'CURRENT_PAGE',open:filtered.filter(row=>row.mode!=='CLOSED').length,pending:filtered.filter(row=>row.requiresHuman||row.unreadCount>0).length,humanAttending:filtered.filter(row=>row.status==='HUMAN_ATTENDING').length},
  }
}
export async function readConversationThread(tenantId, conversationId, input = {}, overrides = {}) {
  const query = overrides.query || queryLiveDocuments
  const getThread = overrides.readConversation || readConversation
  const limit = boundedLimit(input.limit)
  const cursor = decodeConversationCursor(input.before, tenantId, `thread:${conversationId}`)
  let thread = await getThread(tenantId, conversationId, overrides)
  const filters = [{ field: 'conversationId', value: conversationId }]
  const inbound = await query(tenantId, { filters, orderBy: 'receivedAt', limit: limit + 1, cursor })
  if (!thread) thread = groupLegacyConversations(inbound, tenantId).find(row => row.conversationId === conversationId)
  if (!thread) throw new ConversationError('CONVERSATION_NOT_FOUND', 404)
  const outboundAndEvents = await query(tenantId, { filters: [...filters, { field: 'kind', op: 'IN', value: ['OUTBOUND', 'EVENT'] }], orderBy: 'createdAt', limit: limit + 1, cursor })
  const legacyOutbound = []
  const legacyInbound = inbound.filter(row => row.kind !== 'INBOUND')
  for (let offset = 0; offset < legacyInbound.length; offset += 30) {
    const ids = legacyInbound.slice(offset, offset + 30).map(row => row.id)
    if (ids.length) legacyOutbound.push(...await query(tenantId, { filters: [{ field: 'inboundId', op: 'IN', value: ids }], orderBy: 'createdAt', limit: limit + 1, cursor }))
  }
  const context = overrides.commerceContext ? await overrides.commerceContext({tenantId,channel:thread.channel,externalId:thread.externalCustomerId,conversationId,timelineBefore:cursor,timelineLimit:limit+1}) : {customer:null}
  const commerceRows=(context.timelineActivities||[]).map(item=>({...item,direction:'EVENT',senderType:'SYSTEM',status:'RECORDED',source:'COMMERCE'}))
  const rows=[...new Map([...inbound,...outboundAndEvents,...legacyOutbound].filter(row=>row.tenantId===tenantId&&/^(in_|out_|event_)/.test(row.id)).map(row=>[row.id,row])).values(),...commerceRows]
    .sort((a,b)=>timestamp(b).localeCompare(timestamp(a))||b.id.localeCompare(a.id))
  const page=rows.slice(0,limit)
  const oldest=page.at(-1)
  const summary=conversationSummary({...thread,customerId:context.customer?.id||thread.customerId})
  const selectedName=summary.currentSelection?.productId?context.productLookup?.[summary.currentSelection.productId]:null
  const commerce=publicCommerceContext({...context,productInterests:[...new Set([...(context.productInterests||[]),...(selectedName?[selectedName]:[])])]})
  return {ok:true,conversation:summary,timeline:page.reverse().map(row=>row.source==='COMMERCE'?{id:row.id,sourceId:row.sourceId,source:'COMMERCE',conversationId,direction:'EVENT',senderType:'SYSTEM',createdAt:row.createdAt,text:row.text,status:'RECORDED',action:row.type,orderId:row.orderId,attachments:[],deliveryStatus:null}:messageEvent(row,conversationId,context.proofLinks)),customer:context.customer?{...context.customer,identities:context.identities}:null,commerce,
    ...(rows.length>limit&&oldest?{nextCursor:encodeConversationCursor({tenantId,scope:'thread:'+conversationId,at:timestamp(oldest),id:oldest.id})}:{}),
  }

}
export function conversationCustomerIdentity(tenantId, channel, externalIdentifier) {
  if (channel !== 'WHATSAPP') return null
  return conversationIdentity(tenantId, channel, externalIdentifier)
}
export async function readCustomerConversationContext(tenantId, customerId, input = {}, overrides = {}) {
  const context = await overrides.commerceContext({ tenantId, customerId })
  if (!context.customer) throw new ConversationError('CUSTOMER_NOT_FOUND', 404)
  const indexed = await listConversationSummaries(tenantId, { ...input, customerId }, overrides)
  const summaries = new Map(indexed.conversations.map(row => [row.id, row]))
  for (const identity of context.identities || []) {
    const id = conversationCustomerIdentity(tenantId, identity.channel, identity.externalIdentifier)
    if (!id || summaries.has(id)) continue
    const thread = await readConversation(tenantId, id, overrides)
    const recent = thread || groupLegacyConversations(await (overrides.query || queryLiveDocuments)(tenantId, { filters: [{ field: 'conversationId', value: id }], orderBy: 'receivedAt', limit: 1 }), tenantId)[0]
    if (recent) summaries.set(id, conversationSummary({ ...recent, customerId }))
  }
  return { ...indexed, customer: { ...context.customer, identities: context.identities }, conversations: [...summaries.values()], commerce: publicCommerceContext(context) }
}
export const conversationEventId = value => `event_${createHash('sha256').update(value).digest('hex')}`
