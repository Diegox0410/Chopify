import { afterEach,describe,expect,it,vi } from 'vitest'
import handler, { createCatalogHandler } from '../../api/catalog.js'
import { PersistentCommerceRuntime } from './commerceRuntime.js'

const original={VERCEL_ENV:process.env.VERCEL_ENV,CHOPIFY_COMMERCE_ALLOWED_TENANTS:process.env.CHOPIFY_COMMERCE_ALLOWED_TENANTS,CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS:process.env.CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS}
const invokeHandler=async(target:typeof handler,query:Record<string,string>={})=>{
 let status=0,payload='';const headers:Record<string,string>={}
 await target({method:'GET',query},{statusCode:0,setHeader(name,value){headers[name]=value},end(body){status=this.statusCode;payload=body??''}})
 return{status,body:JSON.parse(payload) as unknown,headers}
}
const invoke=(query:Record<string,string>={})=>invokeHandler(handler,query)
afterEach(()=>{vi.restoreAllMocks();for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value}})
describe('Public catalog tenant boundary',()=>{
 it('rejects missing tenant before opening any tenant state',async()=>{
  const execute=vi.spyOn(PersistentCommerceRuntime.prototype,'execute')
  expect((await invoke()).status).toBe(400)
  expect(execute).not.toHaveBeenCalled()
 })
 it('restricts default Preview reads to FLOES',async()=>{
  process.env.VERCEL_ENV='preview';delete process.env.CHOPIFY_COMMERCE_ALLOWED_TENANTS;delete process.env.CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS
  const execute=vi.spyOn(PersistentCommerceRuntime.prototype,'execute')
  expect((await invoke({tenant:'tenant-mg'})).status).toBe(404)
  expect((await invoke({tenant:'tenant-dgng'})).status).toBe(404)
  expect(execute).not.toHaveBeenCalled()
 })
 it('requires explicit authorized tenant and removes internal bot notes',async()=>{
  process.env.CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS='tenant-floes'
  const execute=vi.spyOn(PersistentCommerceRuntime.prototype,'execute').mockResolvedValue([{productId:'fl-pilot',slug:'elite',ganoBotNotes:'internal',images:[{url:'https://example.com/catalogo/floes/elite/black.jpg'}]}])
  const result=await invoke({tenant:'tenant-floes'})
  expect(result.status).toBe(200)
  expect(result.body).toEqual([{productId:'fl-pilot',slug:'elite',images:[{url:'https://example.com/catalogo/floes/elite/black.jpg'}]}])
  expect(execute).toHaveBeenCalledWith({operation:'searchProducts',tenantId:'tenant-floes',input:{query:'',limit:500}})
 })
 it('coalesces concurrent catalog reads, sanitizes cached data, and serves bounded stale data after an upstream failure',async()=>{
  let timestamp=1000,failed=false,calls=0
  const catalog=createCatalogHandler({environment:{VERCEL_ENV:'preview',CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS:'tenant-floes'},now:()=>timestamp,
   loadCatalog:async()=>{calls+=1;await new Promise(resolve=>setTimeout(resolve,10));if(failed)throw new Error('private firestore diagnostic');return[{productId:'synthetic',ganoBotNotes:'private'}]}})
  const concurrent=await Promise.all([invokeHandler(catalog,{tenant:'tenant-floes'}),invokeHandler(catalog,{tenant:'tenant-floes'})])
  expect(calls).toBe(1)
  expect(concurrent[0].body).toEqual([{productId:'synthetic'}])
  expect((await invokeHandler(catalog,{tenant:'tenant-floes'})).headers['X-Catalog-Cache']).toBe('HIT')
  timestamp+=20_000;failed=true
  const stale=await invokeHandler(catalog,{tenant:'tenant-floes'})
  expect(stale.status).toBe(200)
  expect(stale.headers['X-Catalog-Cache']).toBe('STALE')
  expect(stale.body).toEqual([{productId:'synthetic'}])
 })
})
