import { describe, expect, it } from 'vitest'
import {
  availableInventory,
  commitPosition,
  commitReservation,
  expireReservation,
  releasePosition,
  releaseReservation,
  reservePosition,
} from './index'
import type { InventoryPosition, InventoryReservation } from './index'

const position = (): InventoryPosition => ({ tenantId: 'tenant-mg', productId: 'p1', onHand: 10, reserved: 3 })
const reservation = (): InventoryReservation => ({
  id: 'r1',
  tenantId: 'tenant-mg',
  orderId: 'o1',
  items: [{ productId: 'p1', quantity: 2 }],
  status: 'ACTIVE',
  createdAt: '2026-09-27T00:00:00.000Z',
  expiresAt: '2026-09-28T00:00:00.000Z',
})

describe('H3 inventory invariants', () => {
  it('calculates available as onHand minus reserved', () => expect(availableInventory(position())).toBe(7))

  it('reserve increases reserved without reducing onHand', () => {
    expect(reservePosition(position(), 2)).toMatchObject({ onHand: 10, reserved: 5 })
  })

  it('rejects reservation above available stock', () => {
    expect(() => reservePosition(position(), 8)).toThrow('Insufficient STOCK inventory')
  })

  it('release reduces reserved only', () => {
    expect(releasePosition({ ...position(), reserved: 5 }, 2)).toMatchObject({ onHand: 10, reserved: 3 })
  })

  it('commit reduces both onHand and reserved', () => {
    expect(commitPosition({ ...position(), reserved: 5 }, 2)).toMatchObject({ onHand: 8, reserved: 3 })
  })

  it('commits only ACTIVE reservation', () => {
    expect(commitReservation(reservation(), '2026-09-27T12:00:00.000Z').status).toBe('COMMITTED')
    expect(() => commitReservation({ ...reservation(), status: 'COMMITTED' }, '2026-09-27T12:00:00.000Z')).toThrow()
  })

  it('release is idempotent once already RELEASED', () => {
    const released = releaseReservation(reservation(), '2026-09-27T12:00:00.000Z')
    expect(releaseReservation(released, '2026-09-27T13:00:00.000Z')).toBe(released)
  })

  it('expires only after expiration time', () => {
    expect(() => expireReservation(reservation(), '2026-09-27T12:00:00.000Z')).toThrow('Reservation has not expired')
    expect(expireReservation(reservation(), '2026-09-29T00:00:00.000Z').status).toBe('EXPIRED')
  })
})
