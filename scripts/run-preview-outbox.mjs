const base = process.env.CHOPIFY_PREVIEW_URL
const secret = process.env.CRON_SECRET
if (!base || !secret) throw new Error('CHOPIFY_PREVIEW_URL and CRON_SECRET are required')

const url = new URL(base)
if (url.protocol !== 'https:' || !url.hostname.startsWith('chopify-git-') || !url.hostname.endsWith('.vercel.app')) {
  throw new Error('Refusing to call a URL that is not a Vercel Preview deployment')
}

const response = await fetch(new URL('/api/channel-outbox-worker', url), {
  method: 'POST',
  headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
  signal: AbortSignal.timeout(20_000),
})
const result = await response.json().catch(() => ({}))
if (!response.ok || result.ok !== true || result.transport !== 'SYNTHETIC_PREVIEW') {
  throw new Error(`Preview outbox execution failed with HTTP ${response.status}`)
}
console.log(JSON.stringify({ ok: true, transport: result.transport, processed: result.processed, statuses: result.statuses }))
