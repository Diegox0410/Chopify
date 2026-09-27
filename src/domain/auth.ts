export type Role = 'PLATFORM_OWNER' | 'TENANT_OWNER' | 'OPERATOR' | 'FULFILLMENT' | 'CONTENT_OPERATOR'
export type Permission = 'platform:manage' | 'tenant:manage' | 'customer:read' | 'opportunity:manage' | 'order:read' | 'order:manage' | 'fulfillment:manage' | 'content:manage' | 'settlement:read'
const matrix: Record<Role, readonly Permission[]> = {
  PLATFORM_OWNER: ['platform:manage', 'tenant:manage', 'customer:read', 'opportunity:manage', 'order:read', 'order:manage', 'fulfillment:manage', 'content:manage', 'settlement:read'],
  TENANT_OWNER: ['tenant:manage', 'customer:read', 'opportunity:manage', 'order:read', 'order:manage', 'fulfillment:manage', 'content:manage', 'settlement:read'],
  OPERATOR: ['customer:read', 'opportunity:manage', 'order:read', 'order:manage'],
  FULFILLMENT: ['order:read', 'fulfillment:manage'],
  CONTENT_OPERATOR: ['content:manage'],
}
export const hasPermission = (role: Role, permission: Permission) => matrix[role].includes(permission)
