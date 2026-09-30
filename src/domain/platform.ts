import type { EntityId, ISODateTime, TenantScoped } from './shared.js'
import type { Role } from './auth.js'
export interface PlatformUser extends TenantScoped { id:EntityId; name:string; email:string; role:Role; status:'ACTIVE'|'INVITED'|'SUSPENDED'; createdAt:ISODateTime }
export interface TenantProfile extends TenantScoped { ownerName:string; ownerEmail:string; primaryChannel:string; timezone:string; notes?:string }
export type CampaignStatus='DRAFT'|'ACTIVE'|'PAUSED'|'COMPLETED'
export interface ContentCampaign extends TenantScoped { id:EntityId; name:string; status:CampaignStatus; channels:readonly string[]; startAt:ISODateTime; endAt?:ISODateTime; createdAt:ISODateTime }
