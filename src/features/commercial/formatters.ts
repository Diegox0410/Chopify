import type { OpportunityStatus } from '../../domain/index.js'

export const money = (cents: number, currency = 'COP') =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)

export const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(value))
    : '—'

export const statusLabel = (status: string) =>
  status.replaceAll('_', ' ')

export const tenantNames: Record<string, string> = {
  'tenant-mg': 'MG',
  'tenant-dgng': 'DGNG',
  'tenant-floes': 'FLOES',
}

export const operationalStatuses: readonly OpportunityStatus[] = [
  'OPEN',
  'QUALIFIED',
  'CART_STARTED',
  'ORDER_CREATED',
]