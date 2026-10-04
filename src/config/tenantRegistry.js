const definitions = {
  'tenant-floes': { id: 'tenant-floes', slug: 'floes', name: 'FLOES', status: 'ACTIVE' },
  'tenant-dgng': { id: 'tenant-dgng', slug: 'dgng', name: 'DGNG', status: 'ONBOARDING' },
  'tenant-mg': { id: 'tenant-mg', slug: 'mg', name: 'MG Salud y Belleza', status: 'ONBOARDING' },
}

export const tenantDefinitions = Object.freeze(definitions)
export const tenantIds = Object.freeze(Object.keys(definitions))
export const isKnownTenant = tenantId => typeof tenantId === 'string' && tenantId in definitions
