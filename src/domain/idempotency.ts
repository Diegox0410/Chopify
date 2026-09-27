import type { ISODateTime, TenantScoped } from './shared'

export type IdempotentOperation = 'CREATE_ORDER' | 'SUBMIT_PAYMENT_PROOF' | 'APPROVE_PAYMENT' | 'REJECT_PAYMENT' | 'CANCEL_ORDER'
export type IdempotencyStatus = 'STARTED' | 'COMPLETED'
export interface IdempotencyRecord extends TenantScoped { operation: IdempotentOperation; key: string; status: IdempotencyStatus; resultReference?: string; createdAt: ISODateTime; completedAt?: ISODateTime }
