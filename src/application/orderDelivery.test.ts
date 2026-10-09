import { describe, expect, it } from 'vitest'
import { requireOrderDelivery, validateOrderDelivery } from './orderDelivery.js'

const deliveryAddress = { name: ' Ana Pérez ', phone: '+593 (99) 123-4567', city: ' Quito ', province: ' Pichincha ', address: ' Calle 10, casa 12 ', reference: ' Puerta verde ' }

describe('order delivery requirements', () => {
  it('preserves the supplied contact and address, trimming text without assuming a phone country', () => {
    expect(requireOrderDelivery({ deliveryMode: 'SERVIENTREGA', deliveryAddress })).toEqual({
      deliveryMode: 'SERVIENTREGA', deliveryAddress: { name: 'Ana Pérez', phone: '+593991234567', city: 'Quito', province: 'Pichincha', address: 'Calle 10, casa 12', reference: 'Puerta verde' },
    })
    expect(requireOrderDelivery({ deliveryMode: 'SERVIENTREGA', deliveryAddress: { ...deliveryAddress, phone: '0991234567', reference: '' } }).deliveryAddress?.phone).toBe('0991234567')
  })

  it('reports every missing shipping field before Servientrega can receive the order', () => {
    const validation = validateOrderDelivery({ deliveryMode: 'SERVIENTREGA', deliveryAddress: {} })
    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(Object.keys(validation.errors).sort()).toEqual(['address', 'city', 'name', 'phone', 'province'])
    expect(() => requireOrderDelivery({ deliveryMode: 'SERVIENTREGA', deliveryAddress: { ...deliveryAddress, province: ' ' } })).toThrow('Provincia')
  })

  it('supports pickup without a shipping address and requires an address for local delivery', () => {
    expect(requireOrderDelivery({ deliveryMode: 'PICKUP' })).toEqual({ deliveryMode: 'PICKUP' })
    expect(validateOrderDelivery({ deliveryMode: 'LOCAL_DELIVERY' }).ok).toBe(false)
    expect(requireOrderDelivery({ deliveryMode: 'LOCAL_DELIVERY', deliveryAddress }).deliveryMode).toBe('LOCAL_DELIVERY')
  })

  it('rejects invalid modes, phone numbers, text types and excessive address fields', () => {
    for (const deliveryMode of ['WHATSAPP', '', undefined]) expect(validateOrderDelivery({ deliveryMode, deliveryAddress }).ok).toBe(false)
    for (const phone of ['123456', '1234567890123456', '099call4567', '++593991234567', '099\n1234567']) {
      expect(validateOrderDelivery({ deliveryMode: 'SERVIENTREGA', deliveryAddress: { ...deliveryAddress, phone } }).ok).toBe(false)
    }
    for (const patch of [{ name: 42 }, { city: 'A'.repeat(121) }, { address: 'A'.repeat(501) }, { reference: {} }]) {
      expect(validateOrderDelivery({ deliveryMode: 'SERVIENTREGA', deliveryAddress: { ...deliveryAddress, ...patch } }).ok).toBe(false)
    }
  })
})
