import { authorizePlatformOwner } from './firebaseAuth.js'
import { whatsappChannels } from './channelRegistry.js'
import { authorizeOwnerService } from './ownerServiceAuth.js'

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

export function parseMetaProofReference(reference) {
  if (typeof reference !== 'string') return null
  const match = reference.match(/^meta-whatsapp:\/\/(\d{5,30})\/media\/(\d{5,100})$/)
  return match ? { phoneNumberId: match[1], mediaId: match[2] } : null
}

const pdfEscape = value => String(value).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&')
function syntheticReceiptPdf(order, payment) {
  const lines = ['COMPROBANTE FICTICIO - SANDBOX', `Pedido: ${order.id}`, `Importe registrado: ${(payment.amountCents / 100).toFixed(2)} ${payment.currency}`, 'Sin transferencia bancaria real. Solo prueba local/Preview.']
  const stream = `BT /F1 15 Tf 50 760 Td (${pdfEscape(lines[0])}) Tj /F1 11 Tf 0 -34 Td (${pdfEscape(lines[1])}) Tj 0 -24 Td (${pdfEscape(lines[2])}) Tj 0 -24 Td (${pdfEscape(lines[3])}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]
  let document = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xrefOffset = Buffer.byteLength(document)
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(document)
}

async function limitedBytes(response, maxBytes) {
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); return null }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, size)
  } finally { reader.releaseLock() }
}

export async function readPrivateProof({ tenantId, proofId, runtimeClient, env = process.env, fetcher = fetch, channels = whatsappChannels }) {
  if (!runtimeClient) throw new Error('Private proof runtime is unavailable')
  if (!['tenant-floes', 'tenant-mg', 'tenant-dgng'].includes(tenantId) || !proofId || proofId.length > 160) return { status: 404 }
  const reviews = await runtimeClient.execute({ operation: 'listPaymentReviews', tenantId, input: {} })
  const review = Array.isArray(reviews) ? reviews.find(item => item?.proof?.id === proofId) : null
  if (!review || review.proof.tenantId !== tenantId || review.order?.tenantId !== tenantId || review.payment?.tenantId !== tenantId || review.proof.orderId !== review.order.id || review.proof.paymentId !== review.payment.id || review.payment.orderId !== review.order.id) return { status: 404 }
  const media = parseMetaProofReference(review.proof.assetReference)
  if (review.proof.assetReference?.startsWith('sandbox-test://transfer/') && review.payment.method === 'MANUAL_TRANSFER_TEST') {
    return { status: 200, contentType: 'application/pdf', bytes: syntheticReceiptPdf(review.order, review.payment) }
  }
  if (!media) return { status: 422 }
  const channel = channels().find(item => item.tenantId === tenantId && item.externalChannelId === media.phoneNumberId)
  const accessToken = channel && env[channel.accessTokenEnv]
  const version = env.META_GRAPH_VERSION || 'v23.0'
  if (!accessToken || !/^v\d+\.\d+$/.test(version)) return { status: 503 }

  const infoUrl = `https://graph.facebook.com/${version}/${media.mediaId}`
  const info = await fetcher(infoUrl, { headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' }, cache: 'no-store' })
  if (!info.ok) return { status: info.status === 404 ? 404 : 502 }
  const metadata = await info.json().catch(() => null)
  let mediaUrl
  try { mediaUrl = new URL(metadata?.url) } catch { return { status: 502 } }
  if (mediaUrl.protocol !== 'https:' || mediaUrl.hostname !== 'lookaside.fbsbx.com' || mediaUrl.username || mediaUrl.password) return { status: 502 }

  const file = await fetcher(mediaUrl, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', redirect: 'error' })
  if (!file.ok) return { status: file.status === 404 ? 404 : 502 }
  const contentType = (file.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const permittedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
  const maxBytes = 10 * 1024 * 1024
  const declaredSize = Number(file.headers.get('content-length') || metadata?.file_size || 0)
  if (!permittedTypes.has(contentType) || declaredSize > maxBytes) return { status: 415 }
  const bytes = await limitedBytes(file, maxBytes)
  if (!bytes || !bytes.length) return { status: 415 }
  return { status: 200, contentType, bytes }
}

export function createPaymentProofHandler({ authorize, runtimeClient, env = process.env, fetcher = fetch, channels = whatsappChannels } = {}) {
  const authorizeRequest = authorize || (async request => authorizeOwnerService(request, env) ?? authorizePlatformOwner(request))
  return async function paymentProofHandler(req, res) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
    const auth = await authorizeRequest(req)
    if (!auth.ok) return json(res, auth.status, { error: auth.error })
    const tenantId = typeof req.query?.tenantId === 'string' ? req.query.tenantId : ''
    const proofId = typeof req.query?.proofId === 'string' ? req.query.proofId : ''
    if (auth.tenantId && auth.tenantId !== tenantId) return json(res, 403, { error: 'Tenant not allowed' })
    try {
      if (!runtimeClient) throw new Error('Private proof runtime is unavailable')
      const result = await readPrivateProof({ tenantId, proofId, runtimeClient, env, fetcher, channels })
      if (result.status !== 200) {
        if (result.status >= 500) console.error(JSON.stringify({ service: 'payment-proof', stage: 'private_asset_unavailable', tenantId, status: result.status }))
        return json(res, result.status, { error: 'No se pudo cargar el comprobante.' })
      }
      res.statusCode = 200
      res.setHeader('Content-Type', result.contentType)
      res.setHeader('Content-Length', String(result.bytes.length))
      res.setHeader('Content-Disposition', 'inline; filename="comprobante"')
      res.setHeader('Cache-Control', 'private, no-store, max-age=0')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
      res.end(result.bytes)
    } catch {
      console.error(JSON.stringify({ service: 'payment-proof', stage: 'private_asset_failed', tenantId }))
      return json(res, 502, { error: 'No se pudo cargar el comprobante.' })
    }
  }
}
