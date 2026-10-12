export interface UpstreamHttpError extends Error {
  code: 'UPSTREAM_RATE_LIMITED' | 'UPSTREAM_HTTP_ERROR'
  upstreamService: string
  upstreamOperation: string
  upstreamStatus: number
  upstreamCode: string
  retryAfterSeconds?: number
}
export function upstreamResponseError(response: Response, context: { service: string; operation: string }): Promise<UpstreamHttpError>
export function dependencyFailureDetails(error: unknown): {
  errorCode: string
  upstreamService?: string
  upstreamOperation?: string
  upstreamStatus?: number
  upstreamCode?: string
  retryAfterSeconds?: number
}
