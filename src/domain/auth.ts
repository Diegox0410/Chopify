export type Role = 'PLATFORM_OWNER' | 'TENANT_OWNER' | 'OPERATOR' | 'FULFILLMENT' | 'CONTENT_OPERATOR' | 'AUTOMATION' | 'SYSTEM'
export type Permission = 'platform:manage' | 'tenant:manage' | 'customer:read' | 'opportunity:manage' | 'order:read' | 'order:manage' | 'payment:approve' | 'fulfillment:manage' | 'content:manage' | 'settlement:read'
export interface ActorContext { actorId: string; role: Role; tenantId?: string }
const matrix: Record<Role, readonly Permission[]> = {
  PLATFORM_OWNER: ['platform:manage', 'tenant:manage', 'customer:read', 'opportunity:manage', 'order:read', 'order:manage', 'payment:approve', 'fulfillment:manage', 'content:manage', 'settlement:read'],
  TENANT_OWNER: ['tenant:manage', 'customer:read', 'opportunity:manage', 'order:read', 'order:manage', 'payment:approve', 'fulfillment:manage', 'content:manage', 'settlement:read'],
  OPERATOR: ['customer:read', 'opportunity:manage', 'order:read', 'order:manage'],
  FULFILLMENT: ['order:read', 'fulfillment:manage'],
  CONTENT_OPERATOR: ['content:manage'],
  AUTOMATION: ['customer:read', 'opportunity:manage', 'order:read', 'order:manage'],
  SYSTEM: ['order:read'],
}
export const hasPermission = (role: Role, permission: Permission) => matrix[role].includes(permission)
export function authorizeTenant(actor: ActorContext, tenantId: string, permission: Permission): void { if (!hasPermission(actor.role, permission)) throw new Error(`Role ${actor.role} lacks ${permission}`); if (actor.role !== 'PLATFORM_OWNER' && actor.tenantId !== tenantId) throw new Error('Actor tenant mismatch') }
