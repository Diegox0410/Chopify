import { describe,expect,it } from 'vitest'
import { MemoryCommerceStateStore,PersistentCommerceRuntime } from '../../application/commerceRuntime.js'
import { floesCatalog,FLOES_CATEGORIES } from './floes.js'

const request=(operation:Parameters<PersistentCommerceRuntime['execute']>[0]['operation'],input:Record<string,unknown>={})=>({operation,tenantId:'tenant-floes',input,requestId:`test-${operation}`,correlationId:`test-${operation}`,idempotencyKey:`test-${operation}`})
describe('FLOES production catalog seed policy',()=>{
 it('starts empty instead of publishing unverified placeholder products, categories, or variants',()=>{
  expect(floesCatalog).toEqual([])
  expect(FLOES_CATEGORIES).toEqual([])
 })
 it('syncFloesCatalog cannot recreate placeholder products in a new tenant record',async()=>{
  const store=new MemoryCommerceStateStore();const runtime=new PersistentCommerceRuntime(store)
  expect(await runtime.execute(request('syncFloesCatalog'))).toEqual([])
  const record=await store.load('tenant-floes')
  expect(record?.state.orders.products).toEqual([])
  expect(await runtime.execute(request('searchProducts',{query:''}))).toEqual([])
 })
 it('does not create customer orders from a missing or empty informational catalog',async()=>{
  const runtime=new PersistentCommerceRuntime(new MemoryCommerceStateStore())
  const customer=await runtime.execute(request('createOrUpdateCustomer',{name:'Cliente de prueba'})) as {customerId:string}
  await expect(runtime.execute(request('createOrderDraft',{customerId:customer.customerId,lines:[{productId:'tenant-floes:model:daniela',quantity:1}]}))).rejects.toThrow()
 })
 it('serves an approved information-only listing with its model gallery and blocks availability and checkout',async()=>{
  const runtime=new PersistentCommerceRuntime(new MemoryCommerceStateStore())
  await runtime.execute(request('updateProduct',{product:{id:'tenant-floes:model:daniela',tenantId:'tenant-floes',sku:'TEST-DANIELA-PROPOSAL',slug:'daniela',name:'Modelo Daniela',description:'Blusa médica de inspiración polo, clásica y funcional.',commercialSummary:'Blusa médica de inspiración polo, clásica y funcional.',category:'',status:'ACTIVE',visibility:'VISIBLE',fulfillmentMode:'STOCK',pricingStatus:'PENDING',costCents:null,percentage:null,percentageType:null,salePriceCents:null,currency:'USD',images:[1,2,3].map((n)=>({url:`https://www.floes-ec.com/images/editorial/modelos/daniela-0${n}.webp`,alt:`Modelo Daniela · foto ${n}`})),variants:[]}}))
  const [product]=await runtime.execute(request('searchProducts',{query:'Daniela'})) as Array<{productId:string;price:null;available:boolean;variants:unknown[];images:Array<{url:string}>}>
  expect(product).toMatchObject({productId:'tenant-floes:model:daniela',price:null,available:false,variants:[]})
  expect(product.images).toHaveLength(3)
  expect(await runtime.execute(request('checkAvailability',{productId:product.productId}))).toMatchObject({available:false,reason:'inventory_not_configured',pricingStatus:'PENDING'})
  const customer=await runtime.execute(request('createOrUpdateCustomer',{name:'Cliente informativo'})) as {customerId:string}
  await expect(runtime.execute(request('createOrderDraft',{customerId:customer.customerId,lines:[{productId:product.productId,quantity:1}]}))).rejects.toThrow(/pricing is pending/i)
 })
 it('keeps the catalog isolated from other tenants',async()=>{const runtime=new PersistentCommerceRuntime(new MemoryCommerceStateStore());const results=await runtime.execute({...request('searchProducts',{query:''}),tenantId:'tenant-mg'}) as readonly unknown[];expect(results).toHaveLength(0)})
 it('does not persist state or seed products on an empty catalog read',async()=>{const store=new MemoryCommerceStateStore();const first=new PersistentCommerceRuntime(store);await first.execute(request('searchProducts',{query:''}));expect(await store.load('tenant-floes')).toBeNull();const restarted=new PersistentCommerceRuntime(store);expect(await restarted.execute(request('searchProducts',{query:''}))).toEqual([]);expect(await store.load('tenant-floes')).toBeNull()})
})
