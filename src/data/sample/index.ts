import type { HumanEscalation, Tenant } from '../../domain'

const now = '2026-01-01T00:00:00.000Z'
export const sampleTenants: readonly Tenant[] = [
  { id: 'tenant-mg', slug: 'mg', name: 'MG', status: 'ONBOARDING', createdAt: now, updatedAt: now },
  { id: 'tenant-dgng', slug: 'dgng', name: 'DGNG', status: 'ONBOARDING', createdAt: now, updatedAt: now },
  { id: 'tenant-floes', slug: 'floes', name: 'FLOES', status: 'ONBOARDING', createdAt: now, updatedAt: now },
]
export const sampleEscalations: readonly HumanEscalation[] = []
