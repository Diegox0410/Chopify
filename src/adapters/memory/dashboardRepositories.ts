import type { EscalationRepository, TenantRepository } from '../../repositories/contracts'
import type { HumanEscalation, Tenant } from '../../domain'
import { sampleEscalations, sampleTenants } from '../../data/sample'

export class SampleTenantRepository implements TenantRepository {
  async list(): Promise<readonly Tenant[]> { return sampleTenants }
  async getById(id: string): Promise<Tenant | null> { return sampleTenants.find((tenant) => tenant.id === id) ?? null }
}
export class SampleEscalationRepository implements EscalationRepository {
  private readonly items = [...sampleEscalations]
  async listOpen(tenantId?: string): Promise<readonly HumanEscalation[]> { return this.items.filter((item) => item.status !== 'RESOLVED' && (!tenantId || item.tenantId === tenantId)) }
  async save(escalation: HumanEscalation): Promise<void> { this.items.push(escalation) }
}
