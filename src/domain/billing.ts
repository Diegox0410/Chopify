import type { CurrencyCode, EntityId, ISODateTime, TenantScoped } from './shared'

export type SettlementLineType = 'MANAGED_ORDER_FEE' | 'PUBLICATION_FEE' | 'ANNUAL_CONTINUITY' | 'ADJUSTMENT'
export type SettlementStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID'
export interface SettlementLine { id: EntityId; type: SettlementLineType; description: string; amountCents: number; sourceEntityId?: EntityId }
export interface Settlement extends TenantScoped { id: EntityId; currency: CurrencyCode; status: SettlementStatus; periodStart: ISODateTime; periodEnd: ISODateTime; lines: readonly SettlementLine[]; createdAt: ISODateTime }
export const calculateSettlementTotal = (lines: readonly Pick<SettlementLine, 'amountCents'>[]) => lines.reduce((sum, line) => sum + line.amountCents, 0)
