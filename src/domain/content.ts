import type { EntityId,ISODateTime,TenantScoped } from './shared'
export type ContentItemStatus='DRAFT'|'APPROVED'|'SCHEDULED'|'PUBLISHED'|'FAILED'
export interface ContentItem extends TenantScoped { id:EntityId; title:string; body:string; channels:readonly string[]; status:ContentItemStatus; scheduledAt?:ISODateTime; publishedAt?:ISODateTime; campaignId?:EntityId; createdAt:ISODateTime; updatedAt:ISODateTime }
export const publicationUnits=(item:Pick<ContentItem,'channels'|'status'>)=>item.status==='PUBLISHED'?item.channels.length:0
