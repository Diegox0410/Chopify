import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import handler from '../../api/commerce.js'
import type { CommerceGatewayOperation } from './commerceGateway.js'

const keys=['CHOPIFY_COMMERCE_API_TOKEN','CHOPIFY_OPERATIONS_API_TOKEN','CHOPIFY_OWNER_API_TOKEN_FLOES','CHOPIFY_COMMERCE_ALLOWED_TENANTS','CHOPIFY_OPERATIONS_ALLOWED_TENANTS'] as const
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
 it('returns 403 when a valid owner credential targets another tenant',async()=>{const result=await invoke({'x-chopify-tenant-id':'tenant-mg','x-chopify-access-scope':'owner',authorization:'Bearer owner-floes-test'},'listOrders');expect(result.status).toBe(403)})
})
