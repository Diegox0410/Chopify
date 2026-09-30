import type { ContentCampaign,ContentItem,PlatformUser,Settlement,TenantProfile } from '../../domain/index.js'
const at=(d:number)=>`2026-09-${String(d).padStart(2,'0')}T14:00:00.000Z`
export const sampleProfiles:readonly TenantProfile[]=[
 {tenantId:'tenant-mg',ownerName:'Owner MG',ownerEmail:'mg@example.test',primaryChannel:'WHATSAPP',timezone:'America/Guayaquil'},
 {tenantId:'tenant-dgng',ownerName:'Owner DGNG',ownerEmail:'dgng@example.test',primaryChannel:'INSTAGRAM',timezone:'America/Guayaquil'},
 {tenantId:'tenant-floes',ownerName:'Owner FLOES',ownerEmail:'floes@example.test',primaryChannel:'INSTAGRAM',timezone:'America/Guayaquil'}]
export const sampleUsers:readonly PlatformUser[]=[
 {id:'usr-mg-owner',tenantId:'tenant-mg',name:'Owner MG',email:'mg@example.test',role:'TENANT_OWNER',status:'ACTIVE',createdAt:at(1)},
 {id:'usr-dg-owner',tenantId:'tenant-dgng',name:'Owner DGNG',email:'dgng@example.test',role:'TENANT_OWNER',status:'ACTIVE',createdAt:at(1)},
 {id:'usr-fl-owner',tenantId:'tenant-floes',name:'Owner FLOES',email:'floes@example.test',role:'TENANT_OWNER',status:'ACTIVE',createdAt:at(1)},
 {id:'usr-lina',tenantId:'tenant-floes',name:'Lina SAMPLE',email:'lina@example.test',role:'OPERATOR',status:'ACTIVE',createdAt:at(2)}]
export const sampleContent:readonly ContentItem[]=[
 {id:'pub-mg-1',tenantId:'tenant-mg',title:'Bienestar SAMPLE',body:'Contenido SAMPLE',channels:['INSTAGRAM'],status:'SCHEDULED',scheduledAt:at(29),createdAt:at(20),updatedAt:at(25)},
 {id:'pub-dg-1',tenantId:'tenant-dgng',title:'Selección SAMPLE',body:'Contenido SAMPLE',channels:['INSTAGRAM','FACEBOOK'],status:'PUBLISHED',publishedAt:at(24),createdAt:at(20),updatedAt:at(24)},
 {id:'pub-fl-1',tenantId:'tenant-floes',title:'Scrub editorial SAMPLE',body:'Contenido SAMPLE',channels:['INSTAGRAM','FACEBOOK','TIKTOK'],status:'APPROVED',scheduledAt:at(30),createdAt:at(22),updatedAt:at(27)}]
export const sampleCampaigns:readonly ContentCampaign[]=[
 {id:'camp-fl-1',tenantId:'tenant-floes',name:'Lanzamiento FLOES SAMPLE',status:'ACTIVE',channels:['INSTAGRAM','TIKTOK'],startAt:at(20),createdAt:at(18)}]
export const sampleSettlements:readonly Settlement[]=[
 {id:'set-mg-sep',tenantId:'tenant-mg',currency:'COP',status:'DRAFT',periodStart:at(1),periodEnd:at(30),createdAt:at(30),lines:[{id:'l-mg-1',type:'MANAGED_ORDER_FEE',description:'Fee SAMPLE pedido pagado',amountCents:500}]},
 {id:'set-dg-sep',tenantId:'tenant-dgng',currency:'COP',status:'ISSUED',periodStart:at(1),periodEnd:at(30),createdAt:at(30),issuedAt:at(30),lines:[{id:'l-dg-1',type:'MANAGED_ORDER_FEE',description:'Fee SAMPLE pedido pagado',amountCents:2500}]},
 {id:'set-fl-sep',tenantId:'tenant-floes',currency:'COP',status:'DRAFT',periodStart:at(1),periodEnd:at(30),createdAt:at(30),lines:[{id:'l-fl-1',type:'MANAGED_ORDER_FEE',description:'Fee SAMPLE pedidos pagados',amountCents:3200}]}]
