export type TenantStatus = 'ACTIVE' | 'ONBOARDING'
export interface TenantDefinition { readonly id: string; readonly slug: string; readonly name: string; readonly status: TenantStatus }
export const tenantDefinitions: Readonly<Record<string, TenantDefinition>>
export const tenantIds: readonly string[]
export function isKnownTenant(tenantId: unknown): tenantId is string
