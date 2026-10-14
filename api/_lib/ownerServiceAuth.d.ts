export interface OwnerServiceRequest { headers?: Record<string, string | string[] | undefined> }
export type OwnerServiceResult =
  | { ok: true; status: 200; tenantId: string; identity: { uid: string; role: 'TENANT_OWNER' } }
  | { ok: false; status: number; error: string }
export function bearerValue(headers?: OwnerServiceRequest['headers']): string
export function equalSecret(supplied: unknown, expected: unknown): boolean
export function authorizeOwnerService(request: OwnerServiceRequest, env?: NodeJS.ProcessEnv): OwnerServiceResult | null
