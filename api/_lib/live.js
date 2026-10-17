import { createHash, createHmac, createSign, randomUUID, timingSafeEqual } from 'node:crypto'
import { isKnownTenant } from '../../src/config/tenantRegistry.js'
import { resolveWhatsAppChannel } from './channelRegistry.js'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0'
const COLLECTION = process.env.VERCEL_ENV === 'preview' ? 'chopifyWhatsAppLivePreview' : 'chopifyWhatsAppLive'
const now = () => new Date().toISOString()
const hash = value => createHash('sha256').update(value).digest('hex')
const must = key => { const value = process.env[key]; if (!value) throw new Error(`Missing server environment variable: ${key}`); return value }
const json = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }

export function verifyMetaSignature(raw, header, secret) {
  if (!Buffer.isBuffer(raw) || typeof header !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false
  const actual = Buffer.from(header.slice(7), 'hex')
  const expected = createHmac('sha256', secret).update(raw).digest()
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export function verifyChallenge(query, expected) {
  return query?.['hub.mode'] === 'subscribe' && query?.['hub.verify_token'] === expected && typeof query?.['hub.challenge'] === 'string' ? query['hub.challenge'] : null
}
export function extractMessages(payload, expectedPhoneNumberId) {
  if (payload?.object !== 'whatsapp_business_account') return []
  const result = []
  for (const entry of payload.entry || []) for (const change of entry.changes || []) {
    const phoneNumberId = change.value?.metadata?.phone_number_id
    if (change.field !== 'messages' || typeof phoneNumberId !== 'string' || (expectedPhoneNumberId && phoneNumberId !== expectedPhoneNumberId)) continue
    for (const message of change.value.messages || []) {
      if (!message.id || !message.from) continue
      const from = String(message.from).replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(from)) continue
      const media = ['image', 'document'].includes(message.type) ? message[message.type] : undefined
      const mediaId = typeof media?.id === 'string' && /^\d{5,100}$/.test(media.id) ? media.id : undefined
      const text = message.type === 'text' && typeof message.text?.body === 'string'
        ? message.text.body.trim().slice(0, 4000)
        : mediaId ? (typeof media.caption === 'string' ? media.caption.trim().slice(0, 4000) : '') || 'Envío mi comprobante de pago' : ''
      if (!text) continue
      const sentAt = Number(message.timestamp) * 1000
      const customerMessageAt = Number.isFinite(sentAt) && sentAt > 0 && sentAt <= Date.now() + 300000 ? new Date(sentAt).toISOString() : ''
      result.push({ id: message.id, from, text, phoneNumberId, customerMessageAt, ...(mediaId ? { paymentProofReference: `meta-whatsapp://${phoneNumberId}/media/${mediaId}` } : {}), receivedAt: now(), name: change.value.contacts?.find(c => c.wa_id === message.from)?.profile?.name?.slice(0, 100) || '' })
    }
  }
  return result
}
export function extractDeliveryStatuses(payload) {
  if (payload?.object !== 'whatsapp_business_account') return []
  const result = []
  for (const entry of payload.entry || []) for (const change of entry.changes || []) {
    const phoneNumberId = change.value?.metadata?.phone_number_id
    if (change.field !== 'messages' || typeof phoneNumberId !== 'string') continue
    for (const status of change.value.statuses || []) {
      if (typeof status.id !== 'string' || !['sent', 'delivered', 'read', 'failed'].includes(status.status)) continue
      const epoch = Number(status.timestamp) * 1000
      if (!Number.isFinite(epoch) || epoch <= 0) continue
      result.push({ providerMessageId: status.id, phoneNumberId, status: status.status.toUpperCase(), occurredAt: new Date(epoch).toISOString(), errorCode: typeof status.errors?.[0]?.code === 'number' ? status.errors[0].code : null })
    }
  }
  return result
}
export async function recordDeliveryStatus(status, dependencies = {}) {
  const get = dependencies.getDoc || getDoc
  const getRecord = dependencies.get || getLiveRecord
  const commit = dependencies.commit || commitLiveRecords
  const channel = (dependencies.resolveChannel || resolveWhatsAppChannel)(status.phoneNumberId)
  if (!channel || !['SENT','DELIVERED','READ','FAILED'].includes(status.status)) return {ignored:true}
  const mapping = await get('provider_' + hash(status.providerMessageId))
  if (!mapping || mapping.tenantId !== channel.tenantId || mapping.phoneNumberId !== status.phoneNumberId) return {ignored:true}
  const eventId = 'event_delivery_' + hash(status.providerMessageId+':'+status.status+':'+status.occurredAt)
  const rank = {SENT:1,FAILED:2,DELIVERED:3,READ:4}
  for (let attempt=0;attempt<4;attempt+=1) {
    if (await getRecord(eventId)) return {duplicate:true}
    const record = await getRecord(mapping.outboundId)
    const outbound = record?.data
    if (!outbound || outbound.tenantId !== channel.tenantId || outbound.conversationId !== mapping.conversationId) return {ignored:true}
    const advance = (rank[status.status]||0) >= (rank[outbound.deliveryStatus]||0)
    const event = {kind:'EVENT',tenantId:mapping.tenantId,conversationId:mapping.conversationId,outboundId:mapping.outboundId,createdAt:status.occurredAt,
      senderType:'SYSTEM',action:'META_DELIVERY_STATUS',text:'Meta '+status.status,status:status.status,providerMessageId:status.providerMessageId,errorCode:status.errorCode??''}
    const writes = [{id:eventId,data:event}]
    if (advance) writes.push({id:mapping.outboundId,data:{...outbound,deliveryStatus:status.status,deliveryStatusAt:status.occurredAt,...(status.errorCode?{deliveryErrorCode:status.errorCode}:{})},version:record.version})
    if (await commit(writes)) return {recorded:true}
  }
  throw new LiveDependencyError('DELIVERY_STATUS_CONFLICT','Concurrent delivery status could not be recorded')
}
function serviceAccount() {
  let account
  try { account = JSON.parse(must('FIREBASE_SERVICE_ACCOUNT_JSON')) }
  catch { throw new LiveDependencyError('FIRESTORE_SERVICE_ACCOUNT_INVALID', 'Firebase service account configuration is invalid') }
  if (!account.project_id || !account.client_email || !account.private_key) throw new LiveDependencyError('FIRESTORE_SERVICE_ACCOUNT_INVALID', 'Firebase service account configuration is invalid')
  if (process.env.VERCEL_ENV === 'preview') {
    const expectedProject = process.env.CHOPIFY_FIREBASE_PROJECT_ID?.trim()
    if (expectedProject !== 'floes-commercial-sandbox-2026' || account.project_id !== expectedProject) {
      throw new LiveDependencyError('FIRESTORE_PROJECT_MISMATCH', 'Preview Firestore must use the FLOES sandbox project')
    }
  }
  return account
}
let cachedToken = null
async function accessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 120000) return cachedToken.value
  const account = serviceAccount()
  const epoch = Math.floor(Date.now() / 1000)
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const data = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: account.client_email, sub: account.client_email, aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/datastore', iat: epoch, exp: epoch + 3600 })}`
  const sign = createSign('RSA-SHA256'); sign.update(data); sign.end()
  const assertion = `${data}.${sign.sign(account.private_key, 'base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) })
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'FIRESTORE_SERVICE_ACCOUNT_REJECTED' : 'FIREBASE_OAUTH_UNAVAILABLE'
    throw new LiveDependencyError(code, `Firebase OAuth failed (${response.status})`, response.status)
  }
  const token = await response.json()
  cachedToken = { value: token.access_token, expires: Date.now() + Number(token.expires_in || 3600) * 1000 }
  return cachedToken.value
}
const firestoreBase = () => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount().project_id)}/databases/(default)/documents/${COLLECTION}`
function encodeFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { stringValue: String(value ?? '') }]))
}
function decodeFields(document) {
  return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, value.stringValue || '']))
}
const safeLog = (stage, details = {}) => console.info(JSON.stringify({ service: 'whatsapp-live', stage, ...details }))
export class LiveDependencyError extends Error {
  constructor(code, message, httpStatus = null) { super(message); this.name = 'LiveDependencyError'; this.code = code; this.httpStatus = httpStatus }
}
export function escalationReason(error) {
  if (error instanceof LiveDependencyError) return error.code
  if (error instanceof Error && error.name === 'AbortError') return 'GANOBOT_TIMEOUT'
  return 'GANOBOT_UNAVAILABLE'
}
export function metaErrorDetails(status, body) {
  const error = body && typeof body === 'object' ? body.error : null
  return {
    httpStatus: Number(status) || 0,
    metaErrorCode: typeof error?.code === 'number' ? error.code : null,
    metaErrorType: typeof error?.type === 'string' ? error.type.slice(0, 100) : null,
    message: typeof error?.message === 'string' ? error.message.slice(0, 500) : `Meta send failed (${status})`,
    fbtraceId: typeof error?.fbtrace_id === 'string' ? error.fbtrace_id.slice(0, 100) : null,
  }
}
async function firestore(path, options = {}) {
  const token = await accessToken()
  return fetch(`${firestoreBase()}${path}`, { signal: AbortSignal.timeout(10000), ...options, headers: { Authorization: `Bearer ${token}`, ...JSON_HEADERS, ...(options.headers || {}) } })
}
// Conversation metadata and its messages use the existing live collection. The
// update-time precondition makes control transfers and outbound claims atomic.
export async function getLiveRecord(id) {
  const response = await firestore(`/${encodeURIComponent(id)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new LiveDependencyError('CONVERSATION_STORAGE_READ_FAILED', `Firestore read failed (${response.status})`)
  const document = await response.json()
  return { id, data: decodeFields(document), version: document.updateTime }
}
export async function commitLiveRecords(writes) {
  const base = firestoreBase().slice(0, firestoreBase().lastIndexOf('/'))
  const response = await fetch(`${base}:commit`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${await accessToken()}`, ...JSON_HEADERS },
    body: JSON.stringify({ writes: writes.map(write => ({
      update: { name: `${base.slice('https://firestore.googleapis.com/v1/'.length)}/${COLLECTION}/${write.id}`, fields: encodeFields(write.data) },
      currentDocument: write.version ? { updateTime: write.version } : { exists: false },
    })) }),
  })
  if ([409, 412].includes(response.status)) return false
  if (!response.ok) throw new LiveDependencyError('CONVERSATION_STORAGE_WRITE_FAILED', `Firestore commit failed (${response.status})`)
  return true
}
export async function queryLiveDocuments(tenantId, { filters = [], orderBy = '__name__', direction = 'DESCENDING', limit = 26, cursor } = {}) {
  if (!isKnownTenant(tenantId)) throw new Error('Known tenant is required')
  const base = firestoreBase().slice(0, firestoreBase().lastIndexOf('/'))
  const fieldFilters = [{ field: 'tenantId', value: tenantId }, ...filters].map(filter => ({ fieldFilter: {
    field: { fieldPath: filter.field }, op: filter.op || 'EQUAL', value: Array.isArray(filter.value)
      ? { arrayValue: { values: filter.value.map(value => ({ stringValue: value })) } } : { stringValue: String(filter.value) },
  } }))
  const orders = [{ field: { fieldPath: orderBy }, direction }, ...(orderBy === '__name__' ? [] : [{ field: { fieldPath: '__name__' }, direction }])]
  const response = await fetch(`${base}:runQuery`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${await accessToken()}`, ...JSON_HEADERS },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: COLLECTION }],
      where: { compositeFilter: { op: 'AND', filters: fieldFilters } }, orderBy: orders,
      limit: Math.min(Math.max(Number(limit) || 26, 1), 101),
      ...(cursor ? { startAt: { before: false, values: orderBy === '__name__'
        ? [{ referenceValue: `${base.slice('https://firestore.googleapis.com/v1/'.length)}/${COLLECTION}/${cursor.id}` }]
        : [{ stringValue: cursor.at }, { referenceValue: `${base.slice('https://firestore.googleapis.com/v1/'.length)}/${COLLECTION}/${cursor.id}` }] } } : {}),
    } }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = body && typeof body === 'object' ? body.error : null
    const firebaseStatus = error && typeof error === 'object' ? error.status : null
    const firebaseMessage = error && typeof error === 'object' && typeof error.message === 'string' ? error.message.toLowerCase() : ''
    const code = firebaseStatus === 'FAILED_PRECONDITION' || response.status === 400 && /index/.test(firebaseMessage)
      ? 'FIRESTORE_COMPOSITE_INDEX_REQUIRED'
      : firebaseStatus === 'PERMISSION_DENIED' || firebaseStatus === 'UNAUTHENTICATED' || [401, 403].includes(response.status)
        ? 'FIRESTORE_PERMISSION_DENIED'
        : [429, 503].includes(response.status) ? 'FIRESTORE_RATE_OR_SERVICE_LIMITED' : 'CONVERSATION_STORAGE_QUERY_FAILED'
    throw new LiveDependencyError(code, `Firestore query failed (${response.status})`, response.status)
  }
  const rows = await response.json()
  return rows.filter(row => row.document).map(row => ({ ...decodeFields(row.document), id: row.document.name.split('/').at(-1) }))
}
export async function createDoc(id, data) {
  const response = await firestore(`?documentId=${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ fields: encodeFields(data) }) })
  if (response.status === 409) return false
  if (!response.ok) throw new Error(`Firestore create failed (${response.status})`)
  return true
}
export async function getDoc(id) {
  const response = await firestore(`/${encodeURIComponent(id)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Firestore read failed (${response.status})`)
  return decodeFields(await response.json())
}
export async function updateDoc(id, data) {
  const query = new URLSearchParams()
  for (const key of Object.keys(data)) query.append('updateMask.fieldPaths', key)
  const response = await firestore(`/${encodeURIComponent(id)}?${query}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) })
  if (!response.ok) throw new Error(`Firestore update failed (${response.status})`)
}
export async function listPendingOutbox(limit = 20, tenantId) {
  const projectId = encodeURIComponent(serviceAccount().project_id)
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`
  const filters = [{ field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'PENDING' } },
    ...(tenantId ? [{ field: { fieldPath: 'tenantId' }, op: 'EQUAL', value: { stringValue: tenantId } }] : [])]
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, ...JSON_HEADERS },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: filters.length === 1 ? { fieldFilter: filters[0] } : { compositeFilter: { op: 'AND', filters: filters.map(fieldFilter => ({ fieldFilter })) } },
      limit: Math.min(limit, 100),
    } }),
  })
  if (!response.ok) throw new Error(`Firestore query failed (${response.status})`)
  const rows = await response.json()
  return rows.filter(row => row.document?.name?.split('/').at(-1).startsWith('out_')).map(row => ({ id: row.document.name.split('/').at(-1), ...decodeFields(row.document) }))
}
export async function listLiveDocuments(tenantId, limit = 200) {
  if (!isKnownTenant(tenantId)) throw new Error('Unknown tenant')
  const projectId = encodeURIComponent(serviceAccount().project_id)
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, ...JSON_HEADERS },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: { fieldFilter: { field: { fieldPath: 'tenantId' }, op: 'EQUAL', value: { stringValue: tenantId } } },
      limit: Math.min(limit, 500),
    } }),
  })
  if (!response.ok) throw new Error(`Firestore query failed (${response.status})`)
  const rows = await response.json()
  return rows.filter(row => row.document).map(row => ({ id: row.document.name.split('/').at(-1), ...decodeFields(row.document) }))
}
function outboundId(inboundId) { return `out_${hash(inboundId)}` }
function inboundId(providerId) { return `in_${hash(providerId)}` }
export async function prepareReply(message) {
  const endpoint = process.env.GANOBOT_LIVE_URL
  if (!endpoint || !process.env.GANOBOT_LIVE_BEARER_TOKEN) throw new LiveDependencyError('GANOBOT_NOT_CONFIGURED', 'GanoBot live integration is not configured')
  if (!endpoint.startsWith('https://')) throw new LiveDependencyError('GANOBOT_INVALID_CONFIG', 'GanoBot live endpoint must use HTTPS')

  safeLog('ganobot_request', { correlationId: message.correlationId, tenantId: message.tenantId })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${process.env.GANOBOT_LIVE_BEARER_TOKEN}`,
        ...(process.env.CHOPIFY_VERCEL_PROTECTION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.CHOPIFY_VERCEL_PROTECTION_BYPASS_SECRET } : {}),
      },
      body: JSON.stringify({
        tenantId: message.tenantId,
        channel: 'WHATSAPP',
        providerMessageId: message.id,
        customer: {
          phone: message.from,
          name: message.name,
        },
        text: message.text,
        ...(message.conversationId ? { conversationId: message.conversationId } : {}),
        ...(message.customerId ? { customerId: message.customerId } : {}),
        ...(message.paymentProofReference ? { paymentProofReference: message.paymentProofReference } : {}),
        correlationId: message.correlationId,
      }),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LiveDependencyError('GANOBOT_TIMEOUT', 'GanoBot live request timed out')
    }
    throw new LiveDependencyError('GANOBOT_UNAVAILABLE', 'GanoBot live request failed')
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new LiveDependencyError('GANOBOT_HTTP_ERROR', `GanoBot live endpoint failed (${response.status})`)
  }

  const body = await response.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    throw new LiveDependencyError('GANOBOT_INVALID_RESPONSE', 'Invalid GanoBot live response')
  }

  const verifiedCustomerId = body.commerce?.tenantId === message.tenantId && /^[\w:.-]{1,128}$/.test(body.commerce?.customerId || '') ? body.commerce.customerId : undefined

  const verifiedSelection = verifiedCustomerId && /^[\w:.-]{1,128}$/.test(body.commerce?.productId || '') ? { productId: body.commerce.productId, ...(['variantId','color','size'].reduce((result,key) => { if (typeof body.commerce[key] === 'string' && body.commerce[key].length <= 100) result[key] = body.commerce[key]; return result }, {})) } : undefined

  if (body.requiresHuman === true) {
    const allowedReasons = new Set([
      'CUSTOMER_REQUEST',
      'COMPLAINT',
      'PAYMENT_ISSUE',
      'PRICING_EXCEPTION',
      'STOCK_CONFLICT',
      'RETURN_REQUEST',
      'DELIVERY_ISSUE',
      'UNKNOWN_PRODUCT',
      'SYSTEM_ERROR',
      'OTHER',
    ])

    const requestedReason =
      typeof body.escalationReason === 'string'
        ? body.escalationReason.trim().toUpperCase()
        : ''

    const reason = allowedReasons.has(requestedReason)
      ? requestedReason
      : 'OTHER'

    safeLog('ganobot_result', {
      correlationId: message.correlationId,
      tenantId: message.tenantId,
      result: 'HUMAN_REQUESTED',
      escalationReason: reason,
    })

    return {
      requiresHuman: true,
      ...(verifiedCustomerId ? { customerId: verifiedCustomerId } : {}),
      ...(verifiedSelection ? { currentSelection: verifiedSelection } : {}),
      escalationReason: reason,
      mode: 'GANOBOT_LIVE',
    }
  }

  if (
    typeof body.reply !== 'string' ||
    !body.reply.trim() ||
    body.reply.length > 4000
  ) {
    throw new LiveDependencyError('GANOBOT_INVALID_RESPONSE', 'Invalid GanoBot live reply')
  }

  safeLog('ganobot_result', {
    correlationId: message.correlationId,
    tenantId: message.tenantId,
    result: 'VALID_REPLY',
  })

  const messages = Array.isArray(body.messages) ? body.messages.map(item => {
    if (item?.type === 'image' && typeof item.url === 'string') {
      let url
      try { url = new URL(item.url) } catch { throw new LiveDependencyError('GANOBOT_INVALID_RESPONSE', 'Invalid image URL') }
      const catalogBase = process.env.FLOES_PUBLIC_BASE_URL
      if (message.tenantId !== 'tenant-floes' || !catalogBase || url.protocol !== 'https:' || url.origin !== new URL(catalogBase).origin || !url.pathname.startsWith('/catalogo/floes/') || url.username || url.password || url.search || url.hash) {
        throw new LiveDependencyError('GANOBOT_INVALID_RESPONSE', 'Image must use the tenant public catalog')
      }
      return { type: 'image', url: url.href, caption: typeof item.caption === 'string' ? item.caption.slice(0, 1024) : '' }
    }
    if (item?.type === 'text' && typeof item.text === 'string' && item.text.trim() && item.text.length <= 4000) return { type: 'text', text: item.text.trim() }
    throw new LiveDependencyError('GANOBOT_INVALID_RESPONSE', 'Invalid outbound message')
  }).slice(0, 5) : undefined
  return {
    text: body.reply.trim(),
    ...(verifiedCustomerId ? { customerId: verifiedCustomerId } : {}),
      ...(verifiedSelection ? { currentSelection: verifiedSelection } : {}),
    ...(messages?.length ? { messages } : {}),
    requiresHuman: false,
    mode: 'GANOBOT_LIVE',
  }
}

export async function receive(message, dependencies = {}) {
  const createDocument = dependencies.createDoc || createDoc
  const updateDocument = dependencies.updateDoc || updateDoc
  const prepareAutomationReply = dependencies.prepareReply || prepareReply
  const conversations = await import('./conversationStore.js')
  const threadStore = dependencies.conversationStore || {}

  const id = inboundId(message.id)
  if (!isKnownTenant(message.tenantId) || !message.phoneNumberId) throw new Error('Resolved tenant channel is required')
  const correlationId = message.correlationId || message.id
  const customerIdentityKey = hash(`${message.tenantId}:META:WHATSAPP:${message.from}`)
  const conversationId = `conversation_${customerIdentityKey}`

  safeLog('inbound_received', {
    correlationId,
    provider: 'META_WHATSAPP',
  })

  safeLog('tenant_resolved', {
    correlationId,
    tenantId: message.tenantId,
  })

  const inserted = await createDocument(id, {
    kind: 'INBOUND',
    tenantId: message.tenantId,
    channel: 'WHATSAPP',
    provider: 'META',
    providerMessageId: message.id,
    correlationId,
    externalCustomerId: message.from,
    customerIdentityKey,
    conversationId,
    phoneNumberId: message.phoneNumberId,
    from: message.from,
    text: message.text,
    ...(message.paymentProofReference ? { paymentProofReference: message.paymentProofReference } : {}),
    name: message.name,
    receivedAt: message.receivedAt,
    customerMessageAt: message.customerMessageAt ?? message.receivedAt,
    status: 'RECEIVED',
  })

  if (!inserted) return { duplicate: true, id }

  let thread
  try {
    thread = await conversations.recordInboundConversation(message, id, threadStore)
  } catch {
    await updateDocument(id, { status: 'NEEDS_HUMAN', escalationReason: 'SYSTEM_ERROR', technicalReason: 'CONVERSATION_STORAGE_UNAVAILABLE' })
    return { duplicate: false, id, needsHuman: true, escalationReason: 'SYSTEM_ERROR', technicalReason: 'CONVERSATION_STORAGE_UNAVAILABLE' }
  }
  if (thread.mode !== 'GANOBOT_LIVE' || thread.requiresHuman === 'true') {
    await updateDocument(id, { status: 'HUMAN_QUEUED', escalationReason: thread.escalationReason || 'CUSTOMER_REQUEST' })
    return { duplicate: false, id, needsHuman: true, escalationReason: thread.escalationReason || 'CUSTOMER_REQUEST' }
  }

  let decision

  try {
    decision = await prepareAutomationReply({ ...message, conversationId, ...(thread.customerId ? { customerId: thread.customerId } : {}) })
  } catch (error) {
    const technicalReason = escalationReason(error)

    await updateDocument(id, {
      status: 'NEEDS_HUMAN',
      escalationReason: 'SYSTEM_ERROR',
      technicalReason,
      error: error instanceof Error
        ? error.message.slice(0, 500)
        : 'Automation failed',
    })
    await conversations.requireConversationHuman(message.tenantId, conversationId, id, 'SYSTEM_ERROR', technicalReason, threadStore)

    safeLog('automation_decision', {
      correlationId,
      tenantId: message.tenantId,
      decision: 'HUMAN',
      escalationReason: 'SYSTEM_ERROR',
      technicalReason,
    })

    return {
      duplicate: false,
      id,
      needsHuman: true,
      escalationReason: 'SYSTEM_ERROR',
      technicalReason,
    }
  }

  if (decision.customerId && /^[\w:.-]{1,128}$/.test(decision.customerId)) await conversations.updateConversation(message.tenantId, conversationId, current => ({ customerId: current?.customerId || decision.customerId, ...(decision.currentSelection ? { currentSelectionJson: JSON.stringify(decision.currentSelection) } : {}) }), threadStore)

  // Control may have changed while GanoBot was generating its answer. A human
  // takeover suppresses that answer before an outbound becomes dispatchable.
  const latestThread = await conversations.readConversation(message.tenantId, conversationId, threadStore)
  if (!latestThread || latestThread.mode !== 'GANOBOT_LIVE' || latestThread.requiresHuman === 'true') {
    await updateDocument(id, { status: 'HUMAN_QUEUED', escalationReason: 'CUSTOMER_REQUEST' })
    return { duplicate: false, id, needsHuman: true, escalationReason: 'CUSTOMER_REQUEST' }
  }

  if (decision.requiresHuman === true) {
    await updateDocument(id, {
      status: 'NEEDS_HUMAN',
      escalationReason: decision.escalationReason || 'OTHER',
      technicalReason: '',
      error: '',
    })
    await conversations.requireConversationHuman(message.tenantId, conversationId, id, decision.escalationReason || 'OTHER', '', threadStore)

    safeLog('automation_decision', {
      correlationId,
      conversationId,
      senderType: 'GANOBOT',
      tenantId: message.tenantId,
      decision: 'HUMAN',
      escalationReason: decision.escalationReason || 'OTHER',
    })

    return {
      duplicate: false,
      id,
      needsHuman: true,
      escalationReason: decision.escalationReason || 'OTHER',
    }
  }

  const out = outboundId(message.id)

  try {
    const created = await createDocument(out, {
      kind: 'OUTBOUND',
      tenantId: message.tenantId,
      channel: 'WHATSAPP',
      provider: 'META',
      phoneNumberId: message.phoneNumberId,
      correlationId,
      conversationId,
      senderType: 'GANOBOT',
      inboundId: id,
      to: message.from,
      text: decision.text,
      ...(decision.messages?.length ? { messagesJson: JSON.stringify(decision.messages) } : {}),
      mode: decision.mode,
      status: 'PREPARED',
      createdAt: now(),
      attempts: '0',
    })

    if (!created) {
      safeLog('outbound_persistence_duplicate', {
        correlationId,
        tenantId: message.tenantId,
        outboundId: out,
      })

      return {
        duplicate: false,
        id,
        outboundId: out,
      }
    }

    await updateDocument(id, {
      status: 'QUEUED',
      escalationReason: '',
      technicalReason: '',
      error: '',
    })

    await updateDocument(out, {
      status: 'PENDING',
    })
    await conversations.updateConversation(message.tenantId, conversationId, current => current?.mode === 'GANOBOT_LIVE' ? { status: 'WAITING_CUSTOMER' } : null, threadStore)
  } catch (error) {
    await updateDocument(id, {
      status: 'NEEDS_HUMAN',
      escalationReason: 'SYSTEM_ERROR',
      technicalReason: 'OUTBOUND_PERSISTENCE_ERROR',
      error: error instanceof Error
        ? error.message.slice(0, 500)
        : 'Outbound persistence failed',
    }).catch(() => {})
    await conversations.requireConversationHuman(message.tenantId, conversationId, id, 'SYSTEM_ERROR', 'OUTBOUND_PERSISTENCE_ERROR', threadStore).catch(() => {})

    safeLog('automation_decision', {
      correlationId,
      tenantId: message.tenantId,
      decision: 'HUMAN',
      escalationReason: 'SYSTEM_ERROR',
      technicalReason: 'OUTBOUND_PERSISTENCE_ERROR',
    })

    return {
      duplicate: false,
      id,
      needsHuman: true,
      escalationReason: 'SYSTEM_ERROR',
      technicalReason: 'OUTBOUND_PERSISTENCE_ERROR',
    }
  }

  safeLog('automation_decision', {
    correlationId,
    tenantId: message.tenantId,
    decision: 'AUTO_REPLY',
  })

  return {
    duplicate: false,
    id,
    outboundId: out,
  }
}

export async function sendOutbound(id, dependencies = {}) {
  const getDocument=dependencies.getDoc||getDoc
  const createDocument=dependencies.createDoc||createDoc
  const updateDocument=dependencies.updateDoc||updateDoc
  const resolveChannel=dependencies.resolveChannel||resolveWhatsAppChannel
  const request=dependencies.fetch||fetch
  const item = await getDocument(id)
  if (!item || !isKnownTenant(item.tenantId)) return { status: 'NOT_FOUND' }
  if (item.status !== 'PENDING') return { status: item.status }
  const channel = resolveChannel(item.phoneNumberId)
  if (!channel || channel.tenantId !== item.tenantId) return { status: 'CHANNEL_NOT_CONFIGURED' }
  const conversations = await import('./conversationStore.js')
  const threadStore = { ...(dependencies.conversationStore || {}), senderActor: item.sentBy || '' }
  const conversationId = item.conversationId || conversations.conversationIdentity(item.tenantId, 'WHATSAPP', item.to)
  const context = await (dependencies.getConversationDeliveryContext || conversations.getConversationDeliveryContext)({ tenantId: item.tenantId, conversationId }, threadStore)
  if (!context || context.channel !== 'WHATSAPP' || context.phoneNumberId !== item.phoneNumberId || context.recipient !== item.to) return { status: 'CHANNEL_IDENTITY_MISMATCH' }
  const elapsed = Date.now() - Date.parse(context.lastCustomerMessageAt)
  if (!Number.isFinite(elapsed) || elapsed < -300000 || elapsed >= 86400000) return { status: 'OUTSIDE_CUSTOMER_WINDOW' }
  if (!await conversations.readConversation(item.tenantId, conversationId, threadStore)) {
    await conversations.recordInboundConversation({ tenantId: item.tenantId, from: context.recipient, phoneNumberId: context.phoneNumberId, receivedAt: context.lastCustomerMessageAt, name: '', text: '' }, item.inboundId || '', threadStore)
  }
  const senderType = item.senderType || (item.mode === 'HUMAN' ? 'HUMAN' : item.mode === 'SYSTEM' ? 'SYSTEM' : 'GANOBOT')
  let lease
  try { lease = await conversations.claimConversationSend(item.tenantId, conversationId, senderType, undefined, threadStore) }
  catch (error) {
    if (error instanceof conversations.ConversationError) return { status: error.code }
    throw error
  }
  // Durable claim prevents concurrent sends. An interrupted request remains UNKNOWN,
  // requiring manual reconciliation against Meta before an operator retries it.
  if (!await createDocument(`claim_${hash(id)}`, { outboundId: id, claimedAt: now(), claimId: randomUUID() })) {
    await conversations.releaseConversationSend(item.tenantId, conversationId, lease.claimId, {}, threadStore)
    return { status: 'ALREADY_CLAIMED' }
  }
  const attempt = Number(item.attempts || 0) + 1
  await updateDocument(id, { status: 'SENDING', attempts: String(attempt) })
  safeLog('outbound_attempt', { correlationId: item.inboundId || id, outboundId: id, outboundStatus: 'SENDING', attempt })
  try {
    const messages = item.messagesJson ? JSON.parse(item.messagesJson) : [{ type: 'text', text: item.text }]
    if (!Array.isArray(messages) || !messages.length || messages.length > 5) throw new Error('Invalid persisted outbound messages')
    const providerIds = []
    for (const [index, message] of messages.entries()) {
    await conversations.renewConversationSend(item.tenantId, conversationId, lease.claimId, senderType, threadStore)
    const response = message.type === 'image'
      ? await sendImageWithCaption(channel, item.to, message, request)
      : await request(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(channel.externalChannelId)}/messages`, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { ...JSON_HEADERS, Authorization: `Bearer ${must(channel.accessTokenEnv)}` }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: item.to, type: 'text', text: { preview_url: false, body: message.text } }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.messages?.[0]?.id) {
      const details = metaErrorDetails(response.status, body)
      const error = new Error(details.message)
      error.meta = details
      throw error
    }
    providerIds.push(body.messages[0].id)
    await updateDocument(id, { providerMessageIds: JSON.stringify(providerIds), sentMessageCount: String(index + 1) })
    await createDocument(`provider_${hash(body.messages[0].id)}`, { kind: 'PROVIDER_MESSAGE', tenantId: item.tenantId, conversationId, outboundId: id, phoneNumberId: item.phoneNumberId, providerMessageId: body.messages[0].id })
    }
    await updateDocument(id, { status: 'SENT', providerMessageId: providerIds[0], sentAt: now() })
    await conversations.releaseConversationSend(item.tenantId, conversationId, lease.claimId, { lastActivityAt: now(), lastText: item.text || '', ...(senderType === 'GANOBOT' || senderType === 'HUMAN' ? { firstResponseAt: (await conversations.readConversation(item.tenantId, conversationId, threadStore))?.firstResponseAt || now() } : {}) }, threadStore)
    safeLog('meta_send_succeeded', { correlationId: item.inboundId || id, outboundId: id, outboundStatus: 'SENT', sentMessageCount: providerIds.length })
    return { status: 'SENT', providerMessageId: providerIds[0] }
  } catch (error) {
    // Do not auto-retry an ambiguous send: Meta may have accepted it before a timeout.
    const details = error?.meta || { httpStatus: 0, metaErrorCode: null, metaErrorType: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'Unknown send error', fbtraceId: null }
    await updateDocument(id, { status: 'UNKNOWN', error: details.message, httpStatus: details.httpStatus, metaErrorCode: details.metaErrorCode ?? '', metaErrorType: details.metaErrorType ?? '', fbtraceId: details.fbtraceId ?? '' })
    await conversations.releaseConversationSend(item.tenantId, conversationId, lease.claimId, {}, threadStore).catch(() => {})
    console.error(JSON.stringify({ service: 'whatsapp-live', stage: 'meta_send_failed', correlationId: item.inboundId || id, outboundId: id, outboundStatus: 'UNKNOWN', ...details }))
    return { status: 'UNKNOWN', error: details }
  }
}
export async function sendImageWithCaption(channel, to, message, request = fetch) {
  const url = new URL(message.url)
  if (url.protocol !== 'https:' || url.username || url.password || typeof message.caption !== 'string' || message.caption.length > 1024) throw new Error('Invalid catalog image message')
  return request(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(channel.externalChannelId)}/messages`, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${must(channel.accessTokenEnv)}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'image', image: { link: url.href, caption: message.caption } }),
  })
}
export async function handleWebhook(req, res) {
  try {
    if (req.method === 'GET') {
      const challenge = verifyChallenge(req.query, must('META_WHATSAPP_VERIFY_TOKEN'))
      if (challenge === null) return json(res, 403, { error: 'Verification failed' })
      res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); return res.end(challenge)
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
    const raw = await readRaw(req)
    if (!verifyMetaSignature(raw, req.headers['x-hub-signature-256'], must('META_WHATSAPP_APP_SECRET'))) return json(res, 403, { error: 'Invalid signature' })
    const payload = JSON.parse(raw.toString('utf8'))
    for (const status of extractDeliveryStatuses(payload)) await recordDeliveryStatus(status)
    const messages = extractMessages(payload)
    const outcomes = []
    for (const message of messages) {
      const channel = resolveWhatsAppChannel(message.phoneNumberId)
      if (!channel) {
        safeLog('unknown_channel_ignored', { correlationId: message.id })
        continue
      }
      const result = await receive({ ...message, tenantId: channel.tenantId, correlationId: message.id })
      outcomes.push(result)
      if (result.outboundId) await sendOutbound(result.outboundId)
    }
    safeLog('webhook_processed', { requestId: req.headers['x-vercel-id'] || '', messageCount: messages.length, outcomeCount: outcomes.length })
    return json(res, 200, { received: true, count: outcomes.length })
  } catch (error) {
    console.error('WhatsApp webhook error:', error instanceof Error ? error.message : 'unknown')
    return json(res, 503, { error: 'Webhook processing unavailable' })
  }
}
async function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return Buffer.from(req.body)
  // Vercel parses JSON by default. Disable bodyParser in the route config.
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Webhook body too large'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
export async function handleDispatch(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const secret = must('CHOPIFY_DISPATCH_SECRET')
  const supplied = req.headers.authorization?.replace(/^Bearer /, '') || ''
  if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) return json(res, 401, { error: 'Unauthorized' })
  try {
    const items = await listPendingOutbox(20)
    const outcomes = []
    for (const item of items) outcomes.push({ id: item.id, ...await sendOutbound(item.id) })
    return json(res, 200, { outcomes })
  } catch (error) {
    console.error('Dispatch error:', error instanceof Error ? error.message : 'unknown')
    return json(res, 503, { error: 'Dispatch unavailable' })
  }
}
