import { createHash, createHmac, createSign, randomUUID, timingSafeEqual } from 'node:crypto'
import { isKnownTenant } from '../../src/config/tenantRegistry.js'
import { resolveWhatsAppChannel } from './channelRegistry.js'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0'
const COLLECTION = 'chopifyWhatsAppLive'
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
      const text = message.type === 'text' && typeof message.text?.body === 'string' ? message.text.body.trim().slice(0, 4000) : ''
      if (!text) continue // Non-text messages are not auto-answered; handle separately in human inbox.
      result.push({ id: message.id, from, text, phoneNumberId, receivedAt: now(), name: change.value.contacts?.find(c => c.wa_id === message.from)?.profile?.name?.slice(0, 100) || '' })
    }
  }
  return result
}
function serviceAccount() {
  const account = JSON.parse(must('FIREBASE_SERVICE_ACCOUNT_JSON'))
  if (!account.project_id || !account.client_email || !account.private_key) throw new Error('Invalid Firebase service account JSON')
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
  if (!response.ok) throw new Error(`Firebase OAuth failed (${response.status})`)
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
  constructor(code, message) { super(message); this.name = 'LiveDependencyError'; this.code = code }
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
  return fetch(`${firestoreBase()}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...JSON_HEADERS, ...(options.headers || {}) } })
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
export async function listPendingOutbox(limit = 20) {
  const projectId = encodeURIComponent(serviceAccount().project_id)
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, ...JSON_HEADERS },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'PENDING' } } },
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

  return {
    text: body.reply.trim(),
    requiresHuman: false,
    mode: 'GANOBOT_LIVE',
  }
}

export async function receive(message, dependencies = {}) {
  const createDocument = dependencies.createDoc || createDoc
  const updateDocument = dependencies.updateDoc || updateDoc
  const prepareAutomationReply = dependencies.prepareReply || prepareReply

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
    name: message.name,
    receivedAt: message.receivedAt,
    status: 'RECEIVED',
  })

  if (!inserted) return { duplicate: true, id }

  let decision

  try {
    decision = await prepareAutomationReply(message)
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

  if (decision.requiresHuman === true) {
    await updateDocument(id, {
      status: 'NEEDS_HUMAN',
      escalationReason: decision.escalationReason || 'OTHER',
      technicalReason: '',
      error: '',
    })

    safeLog('automation_decision', {
      correlationId,
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
      tenantId: message.tenantId,
      channel: 'WHATSAPP',
      provider: 'META',
      phoneNumberId: message.phoneNumberId,
      correlationId,
      inboundId: id,
      to: message.from,
      text: decision.text,
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
  } catch (error) {
    await updateDocument(id, {
      status: 'NEEDS_HUMAN',
      escalationReason: 'SYSTEM_ERROR',
      technicalReason: 'OUTBOUND_PERSISTENCE_ERROR',
      error: error instanceof Error
        ? error.message.slice(0, 500)
        : 'Outbound persistence failed',
    }).catch(() => {})

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
  // Durable claim prevents concurrent sends. An interrupted request remains UNKNOWN,
  // requiring manual reconciliation against Meta before an operator retries it.
  if (!await createDocument(`claim_${hash(id)}`, { outboundId: id, claimedAt: now(), claimId: randomUUID() })) return { status: 'ALREADY_CLAIMED' }
  const attempt = Number(item.attempts || 0) + 1
  await updateDocument(id, { status: 'SENDING', attempts: String(attempt) })
  safeLog('outbound_attempt', { correlationId: item.inboundId || id, outboundId: id, outboundStatus: 'SENDING', attempt })
  try {
    const response = await request(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(channel.externalChannelId)}/messages`, { method: 'POST', headers: { ...JSON_HEADERS, Authorization: `Bearer ${must(channel.accessTokenEnv)}` }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: item.to, type: 'text', text: { preview_url: false, body: item.text } }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.messages?.[0]?.id) {
      const details = metaErrorDetails(response.status, body)
      const error = new Error(details.message)
      error.meta = details
      throw error
    }
    await updateDocument(id, { status: 'SENT', providerMessageId: body.messages[0].id, sentAt: now() })
    safeLog('meta_send_succeeded', { correlationId: item.inboundId || id, outboundId: id, outboundStatus: 'SENT', httpStatus: response.status })
    return { status: 'SENT', providerMessageId: body.messages[0].id }
  } catch (error) {
    // Do not auto-retry an ambiguous send: Meta may have accepted it before a timeout.
    const details = error?.meta || { httpStatus: 0, metaErrorCode: null, metaErrorType: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'Unknown send error', fbtraceId: null }
    await updateDocument(id, { status: 'UNKNOWN', error: details.message, httpStatus: details.httpStatus, metaErrorCode: details.metaErrorCode ?? '', metaErrorType: details.metaErrorType ?? '', fbtraceId: details.fbtraceId ?? '' })
    console.error(JSON.stringify({ service: 'whatsapp-live', stage: 'meta_send_failed', correlationId: item.inboundId || id, outboundId: id, outboundStatus: 'UNKNOWN', ...details }))
    return { status: 'UNKNOWN', error: details }
  }
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
