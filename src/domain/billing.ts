import type { CurrencyCode, EntityId, ISODateTime, TenantScoped } from './shared.js'
export type SettlementLineType='MANAGED_ORDER_FEE'|'PUBLICATION_FEE'|'ANNUAL_CONTINUITY'|'ADJUSTMENT'
export type SettlementStatus='DRAFT'|'ISSUED'|'PAID'|'VOID'
export interface SettlementLine { id:EntityId; type:SettlementLineType; description:string; amountCents:number; sourceEntityId?:EntityId }
export interface Settlement extends TenantScoped { id:EntityId; currency:CurrencyCode; status:SettlementStatus; periodStart:ISODateTime; periodEnd:ISODateTime; lines:readonly SettlementLine[]; createdAt:ISODateTime; issuedAt?:ISODateTime; paidAt?:ISODateTime }
export const calculateSettlementTotal=(lines:readonly Pick<SettlementLine,'amountCents'>[])=>lines.reduce((s,l)=>s+l.amountCents,0)
export const settlementBalance=(s:Settlement)=>s.status==='PAID'||s.status==='VOID'?0:calculateSettlementTotal(s.lines)
export function issueSettlement(s:Settlement,at:ISODateTime):Settlement { if(s.status!=='DRAFT')throw new Error('Only draft settlements can be issued');if(!s.lines.length)throw new Error('Settlement requires at least one line');return {...s,status:'ISSUED',issuedAt:at} }
export function paySettlement(s:Settlement,at:ISODateTime):Settlement { if(s.status!=='ISSUED')throw new Error('Only issued settlements can be paid');return {...s,status:'PAID',paidAt:at} }
