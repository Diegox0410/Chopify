import type { ActorContext, Order } from '../../domain'

export const ownerActor = (tenantId: string): ActorContext => ({
  actorId: `sample-owner-${tenantId}`,
  role: 'TENANT_OWNER',
  tenantId,
})

export const fulfillmentActor = (tenantId: string): ActorContext => ({
  actorId: `sample-fulfillment-${tenantId}`,
  role: 'FULFILLMENT',
  tenantId,
})

export const operationKey = (operation: string, id: string) =>
  `ui:${operation}:${id}:${Date.now()}`

export const orderNumber = (order: Pick<Order, 'id'>) =>
  order.id.replace('order-', '').toUpperCase()
