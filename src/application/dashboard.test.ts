import { describe, expect, it } from 'vitest'
import { loadDashboard } from './dashboard'
import { SampleEscalationRepository, SampleTenantRepository } from '../adapters/memory/dashboardRepositories'

describe('dashboard use case', () => {
  it('loads sample data through repositories', async () => { const result = await loadDashboard(new SampleTenantRepository(), new SampleEscalationRepository()); expect(result).toMatchObject({ tenantCount: 3, attentionCount: 0, dataMode: 'SAMPLE' }) })
})
