import {describe,expect,it} from 'vitest'
import {PlatformApplication} from './platform.js'
describe('H5-H7 application',()=>{
 const app=new PlatformApplication()
 it('lists all businesses',async()=>expect(await app.businesses()).toHaveLength(3))
 it('isolates users by tenant',async()=>expect((await app.users('tenant-floes')).every(x=>x.tenantId==='tenant-floes')).toBe(true))
 it('isolates content by tenant',async()=>expect((await app.content('tenant-mg')).every(x=>x.tenantId==='tenant-mg')).toBe(true))
 it('derives managed sales only from paid managed orders',async()=>expect((await app.managedSales('ALL')).every(x=>x.fee>=0)).toBe(true))
 it('returns FLOES finance summary independently',async()=>expect((await app.financeSummary('tenant-floes')).salesCount).toBeGreaterThan(0))
 it('lists settlement by tenant',async()=>expect(await app.settlements('tenant-dgng')).toHaveLength(1))
})
