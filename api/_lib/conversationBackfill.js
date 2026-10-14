import { createHash } from 'node:crypto'
import { isKnownTenant } from '../../src/config/tenantRegistry.js'
import { conversationIdentity, conversationMetaId, ConversationError } from './conversationStore.js'
const stable = value => JSON.stringify(value)
const digest = value => createHash('sha256').update(stable(value)).digest('hex')
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
// Preparation consumes an explicit local export. It never scans or writes a
// remote database, and never merges contacts by a name or approximate phone.
export function prepareConversationBackfill({tenantId,records,identities=[],capturedAt}) {
  if (!isKnownTenant(tenantId) || !Array.isArray(records) || !time(capturedAt)) throw new ConversationError('INVALID_BACKFILL_SOURCE',400)
  if (records.some(row=>row.tenantId!==tenantId)) throw new ConversationError('TENANT_NOT_ALLOWED',403)
  const existing = new Set(records.filter(row=>row.kind==='THREAD').map(row=>row.conversationId))
  const groups = new Map()
  for (const row of records.filter(item=>item.id?.startsWith('in_'))) {
    if (!/^\d{8,15}$/.test(row.from||'') || !time(row.receivedAt)) throw new ConversationError('INVALID_BACKFILL_INBOUND',400)
    const id = conversationIdentity(tenantId,'WHATSAPP',row.from)
    if (row.conversationId && row.conversationId !== id) throw new ConversationError('BACKFILL_IDENTITY_CONFLICT',409)
    if (!groups.has(id))groups.set(id,[])
    groups.get(id).push(row)
  }
  const writes=[]
  for(const [conversationId,rows]of groups){
    if(existing.has(conversationId))continue
    rows.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)||a.id.localeCompare(b.id))
    const first=rows[0],last=rows.at(-1)
    const verified=identities.filter(item=>item.tenantId===tenantId&&item.channel==='WHATSAPP'&&item.externalIdentifier===last.from)
    const customerIds=[...new Set(verified.map(item=>item.customerId))]
    if(customerIds.length>1)throw new ConversationError('BACKFILL_IDENTITY_CONFLICT',409)
    const requiresHuman=rows.some(item=>['NEEDS_HUMAN','HUMAN_QUEUED'].includes(item.status))
    writes.push({id:conversationMetaId(conversationId),data:{kind:'THREAD',tenantId,conversationId,channel:'WHATSAPP',provider:'META',externalCustomerId:last.from,
      contact:last.name||'**** '+last.from.slice(-4),createdAt:first.receivedAt,lastActivityAt:last.receivedAt,lastInboundAt:last.customerMessageAt??last.receivedAt,
      lastInboundId:last.id,lastText:last.text||'',phoneNumberId:last.phoneNumberId||'',unreadCount:'0',unreadState:'UNKNOWN_LEGACY',
      mode:requiresHuman?'HUMAN':'GANOBOT_LIVE',status:requiresHuman?'REQUIRES_HUMAN':'AI_ATTENDING',requiresHuman:requiresHuman?'true':'false',
      ...(customerIds[0]?{customerId:customerIds[0]}:{}),backfillCapturedAt:capturedAt,backfillPolicy:'CREATE_MISSING_THREADS_ONLY'}})
  }
  writes.sort((a,b)=>a.id.localeCompare(b.id))
  const sourceFingerprint=digest(records.slice().sort((a,b)=>a.id.localeCompare(b.id)))
  const plan={schemaVersion:1,tenantId,capturedAt,sourceFingerprint,writes}
  return {...plan,fingerprint:digest(plan),summary:{sourceRecords:records.length,existingThreads:existing.size,newThreads:writes.length,commercialWrites:0}}
}
export async function applyConversationBackfill(plan,{expectedFingerprint,authorizedTenant},store){
  if(authorizedTenant!==plan.tenantId||!isKnownTenant(authorizedTenant))throw new ConversationError('TENANT_NOT_ALLOWED',403)
  const payload={schemaVersion:plan.schemaVersion,tenantId:plan.tenantId,capturedAt:plan.capturedAt,sourceFingerprint:plan.sourceFingerprint,writes:plan.writes}
  if(expectedFingerprint!==plan.fingerprint||digest(payload)!==plan.fingerprint)throw new ConversationError('BACKFILL_FINGERPRINT_MISMATCH')
  // Existing metadata is never overwritten. Creation is guarded by exists=false
  // in the same storage CAS used for normal thread updates.
  let created=0,skipped=0
  for(const write of plan.writes){
    if(write.data.tenantId!==authorizedTenant||write.id!==conversationMetaId(write.data.conversationId))throw new ConversationError('TENANT_NOT_ALLOWED',403)
    const existing=await store.get(write.id)
    if(existing){if(existing.data.tenantId!==authorizedTenant)throw new ConversationError('TENANT_NOT_ALLOWED',403);skipped++;continue}
    if(await store.commit([{id:write.id,data:write.data}]))created++;else skipped++
  }
  return {created,skipped,commercialWrites:0}
}
