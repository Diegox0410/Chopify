export const ORDER_DELIVERY_MODES = ['SERVIENTREGA', 'PICKUP', 'LOCAL_DELIVERY'] as const
export type OrderDeliveryMode = typeof ORDER_DELIVERY_MODES[number]

export interface OrderDeliveryAddress {
  name: string
  phone: string
  city: string
  province: string
  address: string
  reference?: string
}

export interface OrderDeliveryInput {
  deliveryMode: OrderDeliveryMode
  deliveryAddress?: OrderDeliveryAddress
}

export type OrderDeliveryValidation =
  | { ok: true; value: OrderDeliveryInput }
  | { ok: false; errors: Record<string, string> }

export function validateOrderDelivery(raw: unknown): OrderDeliveryValidation {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const mode = input.deliveryMode
  if (typeof mode !== 'string' || !(ORDER_DELIVERY_MODES as readonly string[]).includes(mode)) {
    return { ok: false, errors: { deliveryMode: 'Selecciona Servientrega, retiro o delivery local.' } }
  }
  if (mode === 'PICKUP') return { ok: true, value: { deliveryMode: 'PICKUP' } }
  const candidate = input.deliveryAddress
  const rawAddress = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {}
  const errors: Record<string, string> = {}
  const fields = {
    name: { title: 'Nombre de quien recibe', limit: 120 },
    city: { title: 'Ciudad', limit: 120 },
    province: { title: 'Provincia', limit: 120 },
    address: { title: 'Dirección', limit: 500 },
  }
  const values: Record<string, string> = {}
  for (const [field, { title, limit }] of Object.entries(fields)) {
    const rawValue = rawAddress[field]
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!value) errors[field] = `${title} es obligatorio.`
    else if (value.length > limit || /[\x00-\x1f\x7f]/.test(value)) errors[field] = `${title} debe tener hasta ${limit} caracteres.`
    values[field] = value
  }
  const rawPhone = typeof rawAddress.phone === 'string' ? rawAddress.phone.trim() : ''
  const phone = rawPhone.replace(/[\s()-]/g, '')
  if (!/^\+?\d{7,15}$/.test(phone) || rawPhone.length > 40 || /[\x00-\x1f\x7f]/.test(rawPhone)) errors.phone = 'Ingresa un teléfono válido de 7 a 15 dígitos.'
  const reference = typeof rawAddress.reference === 'string' ? rawAddress.reference.trim() : ''
  if (rawAddress.reference != null && typeof rawAddress.reference !== 'string') errors.reference = 'La referencia debe ser texto.'
  else if (reference.length > 500 || /[\x00-\x1f\x7f]/.test(reference)) errors.reference = 'La referencia debe tener hasta 500 caracteres.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: {
    deliveryMode: mode as OrderDeliveryMode,
    deliveryAddress: { name: values.name, phone, city: values.city, province: values.province, address: values.address, ...(reference ? { reference } : {}) },
  } }
}

export function requireOrderDelivery(raw: unknown): OrderDeliveryInput {
  const result = validateOrderDelivery(raw)
  if (!result.ok) throw new Error(Object.values(result.errors).join(' '))
  return result.value
}
