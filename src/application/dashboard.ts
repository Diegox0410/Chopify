import type { TenantRepository, EscalationRepository } from '../repositories/contracts'

export interface DashboardSnapshot { tenantCount: number; attentionCount: number; tenants: readonly { id: string; name: string; status: string }[]; dataMode: 'SAMPLE' | 'LIVE' }
export async function loadDashboard(tenants: TenantRepository, escalations: EscalationRepository): Promise<DashboardSnapshot> {
  const [tenantList, openEscalations] = await Promise.all([tenants.list(), escalations.listOpen()])
  return { tenantCount: tenantList.length, attentionCount: openEscalations.length, tenants: tenantList.map(({ id, name, status }) => ({ id, name, status })), dataMode: 'SAMPLE' }
}
