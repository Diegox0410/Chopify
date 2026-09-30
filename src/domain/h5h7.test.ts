import {describe,expect,it} from 'vitest'
import {calculateSettlementTotal,issueSettlement,paySettlement,publicationUnits,type ContentItem,type Settlement} from './index.js'
const s:Settlement={id:'s',tenantId:'t',currency:'COP',status:'DRAFT',periodStart:'2026-09-01',periodEnd:'2026-09-30',createdAt:'2026-09-30',lines:[{id:'l',type:'MANAGED_ORDER_FEE',description:'fee',amountCents:500}]}
describe('H5-H7 domain',()=>{
 it('totals settlement lines',()=>expect(calculateSettlementTotal(s.lines)).toBe(500))
 it('issues then pays a settlement',()=>expect(paySettlement(issueSettlement(s,'a'),'b').status).toBe('PAID'))
 it('does not issue empty settlement',()=>expect(()=>issueSettlement({...s,lines:[]},'a')).toThrow())
 it('counts one publication unit per published channel',()=>{const c:ContentItem={id:'c',tenantId:'t',title:'x',body:'',channels:['INSTAGRAM','FACEBOOK'],status:'PUBLISHED',createdAt:'a',updatedAt:'a'};expect(publicationUnits(c)).toBe(2)})
})
