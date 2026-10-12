const codePattern = /^[A-Z][A-Z0-9_.-]{0,79}$/

export async function upstreamResponseError(response, { service, operation }) {
  let body
  try { body = await response.clone().json() } catch { body = null }
  const error = body && typeof body === 'object' ? body.error : null
  const details = Array.isArray(error?.details) ? error.details : []
  const errorInfo = details.find(item => String(item?.['@type'] || '').endsWith('google.rpc.ErrorInfo'))
  const candidateCode = errorInfo?.reason || error?.status
  const upstreamCode = typeof candidateCode === 'string' && codePattern.test(candidateCode)
    ? candidateCode
    : `HTTP_${response.status}`
  const retryAfter = Number(response.headers.get('retry-after'))
  const result = new Error(`${service} ${operation} failed (${response.status})`)
  result.name = 'UpstreamHttpError'
  result.code = response.status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_HTTP_ERROR'
  result.upstreamService = service
  result.upstreamOperation = operation
  result.upstreamStatus = response.status
  result.upstreamCode = upstreamCode
  result.retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 300) : undefined
  return result
}

export function dependencyFailureDetails(error) {
  const value = error && typeof error === 'object' ? error : {}
  const upstreamStatus = Number(value.upstreamStatus) || undefined
  return {
    errorCode: typeof value.code === 'string' && codePattern.test(value.code) ? value.code : 'ADMIN_READ_FAILED',
    ...(typeof value.upstreamService === 'string' ? { upstreamService: value.upstreamService } : {}),
    ...(typeof value.upstreamOperation === 'string' ? { upstreamOperation: value.upstreamOperation } : {}),
    ...(upstreamStatus ? { upstreamStatus } : {}),
    ...(typeof value.upstreamCode === 'string' && codePattern.test(value.upstreamCode) ? { upstreamCode: value.upstreamCode } : {}),
    retryAfterSeconds: Number(value.retryAfterSeconds) || (upstreamStatus === 429 ? 15 : undefined),
  }
}
