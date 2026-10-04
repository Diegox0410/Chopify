import { timingSafeEqual } from 'node:crypto'
import { listLiveDocuments } from './_lib/live.js'
import { authorizePlatformOwner } from './_lib/firebaseAuth.js'

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(JSON.stringify(body))
}

const masked = value => {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length > 4 ? `**** ${digits.slice(-4)}` : 'Cliente WhatsApp'
}

const contact = item =>
  typeof item.name === 'string' && /[\p{L}\p{N}]/u.test(item.name)
    ? item.name.slice(0, 100)
    : masked(item.from)

const time = item => item.sentAt || item.createdAt || item.receivedAt || ''

export const validOperationsToken = (supplied, expected) => {
  if (
    typeof supplied !== 'string' ||
    typeof expected !== 'string' ||
    !supplied ||
    !expected
  ) {
    return false
  }

  const actual = Buffer.from(supplied.replace(/^Bearer\s+/i, ''))
  const wanted = Buffer.from(expected)

  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

const OPERATIONS_TENANT_ID = 'tenant-floes'

async function authorize(req) {
  const authorization = req.headers?.authorization

  if (
    validOperationsToken(
      authorization,
      process.env.CHOPIFY_OPERATIONS_API_TOKEN,
    )
  ) {
    return { type: 'operations' }
  }

  const platformOwner = await authorizePlatformOwner(req)

  if (platformOwner.ok) {
    return {
      type: 'platform-owner',
      uid: platformOwner.identity.uid,
    }
  }

  return { type: 'denied', status: platformOwner.status }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    const access = await authorize(req)

    if (access.type === 'denied') {
      return json(res, access.status, { error: access.status === 403 ? 'Forbidden' : 'Unauthorized' })
    }

    const requested =
      typeof req.query?.tenantId === 'string'
        ? req.query.tenantId
        : OPERATIONS_TENANT_ID

    /*
     * Pilot tenant boundary:
     * Both the legacy Operations credential and the authenticated Platform
     * Owner are currently restricted to FLOES conversations.
     *
     * MG and DGNG must receive an explicit tenant authorization model before
     * this boundary is widened.
     */
    if (requested !== OPERATIONS_TENANT_ID) {
      return json(res, 403, { error: 'Tenant not allowed' })
    }

    const documents = await listLiveDocuments(300)

    const inbound = documents.filter(
      item => item.id.startsWith('in_') && item.tenantId === requested,
    )

    const outByInbound = new Map(
      documents
        .filter(
          item => item.id.startsWith('out_') && item.tenantId === requested,
        )
        .map(item => [item.inboundId, item]),
    )

    const rows = inbound
      .map(item => {
        const outbound = outByInbound.get(item.id)

        return {
          id: item.id,
          tenantId: requested,
          channel: 'WHATSAPP',
          contact: contact(item),
          lastActivityAt: time(outbound || item),
          status: item.status || 'RECEIVED',
          mode:
            outbound?.mode ||
            (item.status === 'NEEDS_HUMAN' ? 'HUMAN' : 'PENDING'),
          requiresHuman: item.status === 'NEEDS_HUMAN',
          escalationReason: item.escalationReason || '',
          inbound: {
            status: item.status || 'RECEIVED',
            receivedAt: item.receivedAt || '',
            providerMessageId: item.providerMessageId || '',
          },
          outbound: outbound
            ? {
                status: outbound.status || 'PENDING',
                mode: outbound.mode || '',
                attempts: Number(outbound.attempts || 0),
                createdAt: outbound.createdAt || '',
                sentAt: outbound.sentAt || '',
                providerMessageId: outbound.providerMessageId || '',
                error: outbound.error || '',
                httpStatus: outbound.httpStatus
                  ? Number(outbound.httpStatus)
                  : null,
                metaErrorCode: outbound.metaErrorCode
                  ? Number(outbound.metaErrorCode)
                  : null,
                metaErrorType: outbound.metaErrorType || '',
                fbtraceId: outbound.fbtraceId || '',
              }
            : null,
        }
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))

    return json(res, 200, rows)
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'whatsapp-live',
        stage: 'conversation_read_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    )

    return json(res, 503, {
      error: 'No fue posible cargar conversaciones reales',
    })
  }
}
