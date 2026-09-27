import { describe, expect, it } from 'vitest'
import { createSampleRepositories } from '../adapters/memory/commercialRepositories'
import type { Customer } from '../domain'
import { CommercialApplication } from './commercial'

const fixedNow = '2026-09-27T12:00:00.000Z'
const setup = () => { const repositories = createSampleRepositories(); return { repositories, app: new CommercialApplication(repositories, () => fixedNow) } }

describe('tenant-aware repositories and application use cases', () => {
  it('scopes customer lists to one tenant', async () => { const { repositories } = setup(); const items = await repositories.customers.listByTenant('tenant-mg'); expect(items.length).toBeGreaterThan(0); expect(items.every((item) => item.tenantId === 'tenant-mg')).toBe(true) })
  it('resolves the same external identifier independently per tenant', async () => { const { repositories } = setup(); const mg = await repositories.identities.resolve('tenant-mg', 'WHATSAPP', '3005550101'); const dg = await repositories.identities.resolve('tenant-dgng', 'WHATSAPP', '3005550101'); expect(mg?.customerId).toBe('cus-mg-1'); expect(dg?.customerId).toBe('cus-dg-1') })
  it('rejects a cross-tenant repository mutation', async () => { const { repositories } = setup(); const customer = (await repositories.customers.getById('tenant-mg', 'cus-mg-1')) as Customer; await expect(repositories.customers.save('tenant-dgng', customer)).rejects.toThrow(/Cross-tenant/) })
  it('aggregates platform scope explicitly over known tenants', async () => { const { app } = setup(); const all = await app.listCustomers('ALL'); const mg = await app.listCustomers('tenant-mg'); expect(all.length).toBe(10); expect(mg.length).toBe(4) })
  it('creates a customer and activity through application', async () => { const { app } = setup(); const customer = await app.createCustomer({ tenantId: 'tenant-mg', name: ' Demo User ' }); const detail = await app.getCustomerDetail('tenant-mg', customer.id); expect(customer).toMatchObject({ name: 'Demo User', status: 'LEAD' }); expect(detail?.activities[0].type).toBe('CUSTOMER_CREATED') })
  it('does not expose a customer through another tenant', async () => { const { app } = setup(); expect(await app.getCustomerDetail('tenant-dgng', 'cus-mg-1')).toBeNull() })
  it('creates and transitions an opportunity while appending timeline activity', async () => { const { app } = setup(); const item = await app.createOpportunity({ tenantId: 'tenant-mg', customerId: 'cus-mg-1', intent: 'PURCHASE_INTENT', estimatedValueCents: 2000 }); await app.qualifyOpportunity('tenant-mg', item.id); const updated = await app.getOpportunity('tenant-mg', item.id); const timeline = await app.listCommercialActivities('tenant-mg', { opportunityId: item.id }); expect(updated?.status).toBe('QUALIFIED'); expect(timeline.map((event) => event.type)).toEqual(expect.arrayContaining(['OPPORTUNITY_QUALIFIED', 'OPPORTUNITY_CREATED'])) })
  it('rejects cross-tenant opportunity mutation', async () => { const { app } = setup(); await expect(app.qualifyOpportunity('tenant-dgng', 'opp-mg-1')).rejects.toThrow(/not found/) })
  it('validates note tenant/customer/opportunity consistency', async () => { const { app } = setup(); await expect(app.addCommercialNote({ tenantId: 'tenant-mg', customerId: 'cus-mg-1', opportunityId: 'opp-mg-2', authorId: 'u', body: 'note' })).rejects.toThrow(/must match/) })
  it('creates and completes a task with commercial activity', async () => { const { app } = setup(); const task = await app.createCommercialTask({ tenantId: 'tenant-mg', customerId: 'cus-mg-1', title: ' Call ', priority: 'HIGH' }); const completed = await app.completeCommercialTask('tenant-mg', task.id); const detail = await app.getCustomerDetail('tenant-mg', 'cus-mg-1'); expect(completed.status).toBe('COMPLETED'); expect(detail?.activities.some((event) => event.type === 'TASK_COMPLETED')).toBe(true) })
})
