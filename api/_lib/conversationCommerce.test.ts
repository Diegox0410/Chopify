import { describe, expect, it } from 'vitest'
import { createTenantCommerceState } from '../../src/application/commerceRuntime.js'
import { readConversationCommerceContext } from './conversationCommerce.js'

describe('read-only conversation commerce context', () => {
  const fixture = () => {
    const state = createTenantCommerceState('tenant-floes'); state.orders.products = []
    state.commercial.customers.push({ id: 'customer-floes', tenantId: 'tenant-floes', name: 'Clienta', status: 'ACTIVE', createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' })
    state.commercial.identities.push({ id: 'identity-verified', tenantId: 'tenant-floes', customerId: 'customer-floes', channel: 'WHATSAPP', externalIdentifier: '593999999999', createdAt: '2026-10-13T00:00:00.000Z' })
    const reads: string[] = []
    return { state, reads, store: { load: async (tenantId: string) => { reads.push(tenantId); return {state, version:'version-one', migrated:true} } } }
  }
  it('uses exactly one scoped load and never initializes or writes state even when migrated', async () => {
    const {store, reads} = fixture()
    const result = await readConversationCommerceContext({tenantId:'tenant-floes',channel:'WHATSAPP',externalId:'593999999999'},store)
    expect(result.customer?.id).toBe('customer-floes'); expect(reads).toEqual(['tenant-floes'])
  })
  it('does not infer a cross-channel identity from matching contacts', async () => {
    const {store} = fixture()
    const result = await readConversationCommerceContext({tenantId:'tenant-floes',channel:'INSTAGRAM',externalId:'593999999999'},store)
    expect(result.customer).toBeNull()
    await expect(readConversationCommerceContext({tenantId:'tenant-floes',customerId:'customer-floes',channel:'INSTAGRAM',externalId:'593999999999'},store)).rejects.toThrow('identity does not match')
  })
  it('does not seed commercial fixtures when the tenant state is absent', async () => {
    const result = await readConversationCommerceContext({tenantId:'tenant-floes',customerId:'customer-missing'},{load:async()=>null})
    expect(result.customer).toBeNull(); expect(result.orders).toEqual([])
  })
  it('filters foreign-tenant customers even if supplied by a faulty store adapter', async () => {
    const {state,store} = fixture(); state.commercial.customers[0].tenantId='tenant-mg'
    const result = await readConversationCommerceContext({tenantId:'tenant-floes',customerId:'customer-floes'},store)
    expect(result.customer).toBeNull()
  })
})
