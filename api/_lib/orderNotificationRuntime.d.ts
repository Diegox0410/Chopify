import type { PersistentCommerceRuntime } from '../../src/application/commerceRuntime.js'
export interface NotificationResult { status:string;correlationId?:string;outboundId?:string;reason?:string }
export function orderNotifier(runtime: Pick<PersistentCommerceRuntime,'execute'>): (input:{operation:string;tenantId:string;input:Record<string,unknown>;data:unknown})=>Promise<NotificationResult>
