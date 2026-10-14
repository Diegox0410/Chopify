import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import handler from '../../api/commerce.js'
import type { CommerceGatewayOperation } from './commerceGateway.js'
import { PersistentCommerceRuntime } from './commerceRuntime.js'

const keys=['CHOPIFY_COMMERCE_API_TOKEN','CHOPIFY_OPERATIONS_API_TOKEN','CHOPIFY_OWNER_API_TOKEN_FLOES','CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN','CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES','CHOPIFY_COMMERCE_ALLOWED_TENANTS','CHOPIFY_OPERATIONS_ALLOWED_TENANTS','VERCEL_ENV'] as const
const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
const invoke=async(headers:Record<string,string>,operation:CommerceGatewayOperation='searchProducts')=>{
 let status=0;let payload=''
 await handler({method:'POST',headers,body:{operation,input:{}}},{statusCode:0,setHeader(){},end(body){payload=body??'';status=this.statusCode}})
 return{status,body:JSON.parse(payload) as {error?:string}}
}

describe('Commerce API authorization boundary',()=>{
 beforeAll(()=>{process.env.CHOPIFY_COMMERCE_API_TOKEN='commerce-test';process.env.CHOPIFY_OPERATIONS_API_TOKEN='operations-test';process.env.CHOPIFY_OWNER_API_TOKEN_FLOES='owner-floes-test';process.env.CHOPIFY_COMMERCE_ALLOWED_TENANTS='tenant-floes,tenant-mg';delete process.env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS})
 afterAll(()=>{for(const key of keys){const value=previous[key];if(value===undefined)delete process.env[key];else process.env[key]=value}})
 it('returns 401 for missing or invalid credentials',async()=>{expect((await invoke({'x-chopify-tenant-id':'tenant-floes'})).status).toBe(401);expect((await invoke({'x-chopify-tenant-id':'tenant-floes',authorization:'Bearer wrong'})).status).toBe(401)})
 it('returns 403 when a valid Operations credential crosses its allowlist',async()=>{const result=await invoke({'x-chopify-tenant-id':'tenant-mg',authorization:'Bearer operations-test'},'listOrders');expect(result.status).toBe(403)})
 it('rejects an Owner credential when the credential for the requested tenant is unavailable',async()=>{const result=await invoke({'x-chopify-tenant-id':'tenant-mg','x-chopify-access-scope':'owner',authorization:'Bearer owner-floes-test'},'listOrders');expect(result.status).toBe(401)})
 it('automation cannot approve payments or impersonate an Owner',async()=>{
  expect((await invoke({'x-chopify-tenant-id':'tenant-floes',authorization:'Bearer commerce-test'},'approvePayment')).status).toBe(401)
  expect((await invoke({'x-chopify-tenant-id':'tenant-floes','x-chopify-access-scope':'owner',authorization:'Bearer commerce-test'},'approvePayment')).status).toBe(401)
 })
 it('derives the payment approval actor from the authenticated Owner credential',async()=>{
  const execute=vi.spyOn(PersistentCommerceRuntime.prototype,'execute').mockResolvedValue({status:'approved'})
  try{
   const result=await invoke({'x-chopify-tenant-id':'tenant-floes','x-chopify-access-scope':'owner',authorization:'Bearer owner-floes-test'},'approvePayment')
   expect(result.status).toBe(200)
   expect(execute).toHaveBeenCalledWith(expect.objectContaining({actor:{actorId:'service-owner:tenant-floes',role:'TENANT_OWNER',tenantId:'tenant-floes'}}))
  }finally{execute.mockRestore()}
 })
 it('allows delivery and follow-up through Commerce automation credentials',async()=>{
  const execute=vi.spyOn(PersistentCommerceRuntime.prototype,'execute').mockResolvedValue({})
  try{
   for(const operation of ['updateOrderDelivery','recordOrderFollowUp'] as const){
    expect((await invoke({'x-chopify-tenant-id':'tenant-floes',authorization:'Bearer commerce-test'},operation)).status).toBe(200)
   }
   expect(execute).toHaveBeenCalledWith(expect.objectContaining({actor:{actorId:'ganobot-commerce',role:'AUTOMATION',tenantId:'tenant-floes'}}))
  }finally{execute.mockRestore()}
 })
 it('accepts dedicated Preview E2E credentials only in Preview',async()=>{
  const execute=vi.spyOn(PersistentCommerceRuntime.prototype,'execute').mockResolvedValue({})
  try{
   process.env.VERCEL_ENV='preview'
   process.env.CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN='preview-e2e-commerce-test'
   process.env.CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES='preview-e2e-owner-test'
   expect((await invoke({'x-chopify-tenant-id':'tenant-floes',authorization:'Bearer preview-e2e-commerce-test'})).status).toBe(200)
   expect((await invoke({'x-chopify-tenant-id':'tenant-floes','x-chopify-access-scope':'owner',authorization:'Bearer preview-e2e-owner-test'},'listOrders')).status).toBe(200)
   process.env.VERCEL_ENV='production'
   expect((await invoke({'x-chopify-tenant-id':'tenant-floes',authorization:'Bearer preview-e2e-commerce-test'})).status).toBe(401)
   expect((await invoke({'x-chopify-tenant-id':'tenant-floes','x-chopify-access-scope':'owner',authorization:'Bearer preview-e2e-owner-test'},'listOrders')).status).toBe(401)
  }finally{execute.mockRestore()}
 })
})
