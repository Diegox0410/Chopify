import { createHash, createHmac, createSign, randomUUID, timingSafeEqual } from 'node:crypto'

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
export function extractMessages(payload, phoneNumberId) {
  if (payload?.object !== 'whatsapp_business_account') return []
  const result = []
  for (const entry of payload.entry || []) for (const change of entry.changes || []) {
    if (change.field !== 'messages' || change.value?.metadata?.phone_number_id !== phoneNumberId) continue
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
function outboundId(inboundId) { return `out_${hash(inboundId)}` }
function inboundId(providerId) { return `in_${hash(providerId)}` }
export async function prepareReply(message) {
  const endpoint = process.env.GANOBOT_LIVE_URL
  if (!endpoint) return { text: '¡Hola! Gracias por escribir a FLOES. Hemos recibido tu mensaje y un asesor continuará tu atención.', mode: 'HUMAN_FALLBACK' }
  if (!endpoint.startsWith('https://')) throw new Error('GANOBOT_LIVE_URL must use HTTPS')
  const response = await fetch(endpoint, { method: 'POST', headers: { ...JSON_HEADERS, Authorization: `Bearer ${must('GANOBOT_LIVE_BEARER_TOKEN')}` }, body: JSON.stringify({ tenantId: 'tenant-floes', channel: 'WHATSAPP', providerMessageId: message.id, customer: { phone: message.from, name: message.name }, text: message.text }) })
  if (!response.ok) throw new Error(`GanoBot live endpoint failed (${response.status})`)
  const body = await response.json()
  if (typeof body.reply !== 'string' || !body.reply.trim() || body.reply.length > 4000) throw new Error('Invalid GanoBot live reply')
  return { text: body.reply.trim(), mode: 'GANOBOT_LIVE' }
}
export async function receive(message) {
  const id = inboundId(message.id)
  const inserted = await createDoc(id, { tenantId: 'tenant-floes', providerMessageId: message.id, phoneNumberId: message.phoneNumberId, from: message.from, text: message.text, name: message.name, receivedAt: message.receivedAt, status: 'RECEIVED' })
  if (!inserted) return { duplicate: true, id }
  const out = outboundId(message.id)
  try {
    const reply = await prepareReply(message)
    await createDoc(out, { tenantId: 'tenant-floes', inboundId: id, to: message.from, text: reply.text, mode: reply.mode, status: 'PENDING', createdAt: now(), attempts: '0' })
    await updateDoc(id, { status: 'QUEUED' })
    return { duplicate: false, id, outboundId: out }
  } catch (error) {
    await updateDoc(id, { status: 'NEEDS_HUMAN', error: error instanceof Error ? error.message : 'GanoBot failed' })
    return { duplicate: false, id, needsHuman: true }
  }
}
export async function sendOutbound(id) {
  const item = await getDoc(id)
  if (!item || item.tenantId !== 'tenant-floes') return { status: 'NOT_FOUND' }
  if (item.status !== 'PENDING') return { status: item.status }
  // Durable claim prevents concurrent sends. An interrupted request remains UNKNOWN,
  // requiring manual reconciliation against Meta before an operator retries it.
  if (!await createDoc(`claim_${hash(id)}`, { outboundId: id, claimedAt: now(), claimId: randomUUID() })) return { status: 'ALREADY_CLAIMED' }
  await updateDoc(id, { status: 'SENDING', attempts: String(Number(item.attempts || 0) + 1) })
  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(must('FLOES_WHATSAPP_PHONE_NUMBER_ID'))}/messages`, { method: 'POST', headers: { ...JSON_HEADERS, Authorization: `Bearer ${must('META_WHATSAPP_ACCESS_TOKEN')}` }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: item.to, type: 'text', text: { preview_url: false, body: item.text } }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || !body.messages?.[0]?.id) throw new Error(`Meta send failed (${response.status})`)
    await updateDoc(id, { status: 'SENT', providerMessageId: body.messages[0].id, sentAt: now() })
    return { status: 'SENT', providerMessageId: body.messages[0].id }
  } catch (error) {
    // Do not auto-retry an ambiguous send: Meta may have accepted it before a timeout.
    await updateDoc(id, { status: 'UNKNOWN', error: error instanceof Error ? error.message : 'Unknown send error' })
    return { status: 'UNKNOWN' }
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
    const messages = extractMessages(payload, must('FLOES_WHATSAPP_PHONE_NUMBER_ID'))
    const outcomes = []
    for (const message of messages) {
      const result = await receive(message)
      outcomes.push(result)
      if (result.outboundId) await sendOutbound(result.outboundId)
    }
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
