import { describe, expect, it } from 'vitest'
import { createSampleRepositories } from '../adapters/memory/commercialRepositories'
import { CommercialApplication } from './commercial'

describe('H2 dashboard projection', () => {
  it('derives sample metrics from tenant-aware repositories', async () => { const app = new CommercialApplication(createSampleRepositories(), () => '2026-09-27T12:00:00.000Z'); const result = await app.loadDashboard('ALL'); expect(result).toMatchObject({ dataMode: 'SAMPLE', tenants: expect.arrayContaining([expect.objectContaining({ id: 'tenant-mg' })]) }); expect(result.pipeline.totalOpenPipelineValue).toBeGreaterThan(0) })
  it('filters dashboard metrics to one tenant', async () => { const app = new CommercialApplication(createSampleRepositories(), () => '2026-09-27T12:00:00.000Z'); const result = await app.loadDashboard('tenant-mg'); expect(result.tenants.map((item) => item.id)).toEqual(['tenant-mg']); expect(result.conversions.totalOpportunities).toBe(5) })
})
