/// <reference types="node" />
import { createHash, createSign } from 'node:crypto'

export interface ServiceAccountCredentials {
  project_id: string
  client_email: string
  private_key: string
}

export type ServerEnvironment = Record<string, string | undefined>
export type ServerFetch = typeof fetch

const tokens = new WeakMap<ServerFetch, Map<string, { value: string; expires: number }>>()

export function serviceAccountCredentials(env: ServerEnvironment): ServiceAccountCredentials {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) throw new Error('Missing server environment variable: FIREBASE_SERVICE_ACCOUNT_JSON')
  let account: Partial<ServiceAccountCredentials>
  try { account = JSON.parse(raw) as Partial<ServiceAccountCredentials> }
  catch { throw new Error('Invalid Firebase service account JSON') }
  if (!account || typeof account.project_id !== 'string' || !account.project_id.trim() ||
      typeof account.client_email !== 'string' || !account.client_email.trim() ||
      typeof account.private_key !== 'string' || !account.private_key.trim()) {
    throw new Error('Invalid Firebase service account JSON')
  }
  return account as ServiceAccountCredentials
}

export async function serviceAccountAccessToken(
  env: ServerEnvironment,
  scope: string,
  request: ServerFetch = fetch,
): Promise<string> {
  const account = serviceAccountCredentials(env)
  const fingerprint = createHash('sha256').update(JSON.stringify(account)).update(scope).digest('hex')
  const cache = tokens.get(request) ?? new Map<string, { value: string; expires: number }>()
  tokens.set(request, cache)
  const previous = cache.get(fingerprint)
  if (previous && previous.expires > Date.now() + 120_000) return previous.value

  const now = Math.floor(Date.now() / 1000)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email, sub: account.client_email,
    aud: 'https://oauth2.googleapis.com/token', scope, iat: now, exp: now + 3600,
  })}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  let signature: string
  try { signature = signer.sign(account.private_key, 'base64url') }
  catch { throw new Error('Invalid Firebase service account private key') }
  const response = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Firebase OAuth failed (${response.status})`)
  const token = await response.json() as { access_token?: unknown; expires_in?: unknown }
  if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('Firebase OAuth returned no access token')
  const lifetime = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in : 3600
  cache.set(fingerprint, { value: token.access_token, expires: Date.now() + lifetime * 1000 })
  return token.access_token
}
