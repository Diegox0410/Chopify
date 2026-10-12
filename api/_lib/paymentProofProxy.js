import { authorizePlatformOwner } from './firebaseAuth.js'
import { whatsappChannels } from './channelRegistry.js'

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

export async function readPrivateProof({ tenantId, proofId, runtimeClient, env = process.env, fetcher = fetch, channels = whatsappChannels }) {
  if (!runtimeClient) throw new Error('Private proof runtime is unavailable')
  if (!['tenant-floes', 'tenant-mg', 'tenant-dgng'].includes(tenantId) || !proofId || proofId.length > 160) return { status: 404 }
  const reviews = await runtimeClient.execute({ operation: 'listPaymentReviews', tenantId, input: {} })
  const review = Array.isArray(reviews) ? reviews.find(item => item?.proof?.id === proofId) : null
  if (!review || review.proof.tenantId !== tenantId || review.order?.tenantId !== tenantId || review.payment?.tenantId !== tenantId || review.proof.orderId !== review.order.id || review.proof.paymentId !== review.payment.id || review.payment.orderId !== review.order.id) return { status: 404 }
  const media = parseMetaProofReference(review.proof.assetReference)
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
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!bytes.length || bytes.length > maxBytes) return { status: 415 }
  return { status: 200, contentType, bytes }
}

export function createPaymentProofHandler({ authorize = authorizePlatformOwner, runtimeClient, env = process.env, fetcher = fetch, channels = whatsappChannels } = {}) {
  return async function paymentProofHandler(req, res) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
    const auth = await authorize(req)
    if (!auth.ok) return json(res, auth.status, { error: auth.error })
    const tenantId = typeof req.query?.tenantId === 'string' ? req.query.tenantId : ''
    const proofId = typeof req.query?.proofId === 'string' ? req.query.proofId : ''
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
