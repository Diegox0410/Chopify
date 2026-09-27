import type { EntityId, ISODateTime, TenantScoped } from './shared'

export type FulfillmentMode = 'STOCK' | 'MADE_TO_ORDER' | 'HYBRID' | 'DIGITAL' | 'SERVICE'
export interface InventoryPosition extends TenantScoped { productId: EntityId; variantId?: EntityId; onHand: number; reserved: number }
export interface InventoryReservationItem { productId: EntityId; variantId?: EntityId; quantity: number }
export type InventoryReservationStatus = 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED'
export interface InventoryReservation extends TenantScoped { id: EntityId; orderId: EntityId; items: readonly InventoryReservationItem[]; status: InventoryReservationStatus; createdAt: ISODateTime; expiresAt?: ISODateTime; committedAt?: ISODateTime; releasedAt?: ISODateTime; expiredAt?: ISODateTime }
export const availableInventory = (position: InventoryPosition) => Math.max(0, position.onHand - position.reserved)
const quantity = (value: number) => { if (!Number.isInteger(value) || value <= 0) throw new Error('Inventory quantity must be a positive integer') }
export function reservePosition(position: InventoryPosition, amount: number): InventoryPosition { quantity(amount); if (availableInventory(position) < amount) throw new Error('Insufficient STOCK inventory'); return { ...position, reserved: position.reserved + amount } }
export function releasePosition(position: InventoryPosition, amount: number): InventoryPosition { quantity(amount); if (position.reserved < amount) throw new Error('Cannot release more inventory than reserved'); return { ...position, reserved: position.reserved - amount } }
export function commitPosition(position: InventoryPosition, amount: number): InventoryPosition { quantity(amount); if (position.reserved < amount || position.onHand < amount) throw new Error('Cannot commit unavailable inventory'); return { ...position, onHand: position.onHand - amount, reserved: position.reserved - amount } }
export function commitReservation(item: InventoryReservation, at: string): InventoryReservation { if (item.status !== 'ACTIVE') throw new Error('Only an active reservation can be committed'); return { ...item, status: 'COMMITTED', committedAt: at } }
export function releaseReservation(item: InventoryReservation, at: string): InventoryReservation { if (item.status === 'RELEASED') return item; if (item.status !== 'ACTIVE') throw new Error('Only an active reservation can be released'); return { ...item, status: 'RELEASED', releasedAt: at } }
export function expireReservation(item: InventoryReservation, at: string): InventoryReservation { if (item.status !== 'ACTIVE') throw new Error('Only an active reservation can expire'); if (item.expiresAt && at < item.expiresAt) throw new Error('Reservation has not expired'); return { ...item, status: 'EXPIRED', expiredAt: at } }
