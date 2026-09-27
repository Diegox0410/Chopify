import {describe,expect,it} from 'vitest'
import {createSampleRepositories} from '../adapters/memory/commercialRepositories'
import {createSampleOrderRepositories} from '../adapters/memory/orderRepositories'
import {createMemoryGanoBotRepositories} from '../adapters/memory/ganobotRepositories'
import {createMemoryWhatsAppRepositories,SampleWhatsAppAdapter} from '../adapters/memory/whatsappRepositories'
import {CommercialApplication} from './commercial'
import {OrderApplication} from './orders'
import {GanoBotApplication} from './ganobot'
import {WhatsAppApplication} from './whatsapp'
import type {WhatsAppConnection} from '../domain'
const connection:WhatsAppConnection={id:'wa-fl',tenantId:'tenant-floes',phoneNumberId:'pn-fl',status:'ACTIVE',createdAt:'2026-09-27T12:00:00.000Z',updatedAt:'2026-09-27T12:00:00.000Z'}
function setup(){
 const commercialRepos=createSampleRepositories();const commercial=new CommercialApplication(commercialRepos,()=> '2026-09-27T12:00:00.000Z')
 const orderRepos=createSampleOrderRepositories();const orders=new OrderApplication({tenants:commercialRepos.tenants,customers:commercialRepos.customers,opportunities:commercialRepos.opportunities,activities:commercialRepos.activities,...orderRepos},()=> '2026-09-27T12:00:00.000Z')
 const gbRepos=createMemoryGanoBotRepositories();const ganobot=new GanoBotApplication(commercial,orders,orderRepos.commerce,gbRepos.sessions,gbRepos.traces,()=> '2026-09-27T12:00:00.000Z')
 const waRepos=createMemoryWhatsAppRepositories([connection]);const channel=new SampleWhatsAppAdapter()
 return{app:new WhatsAppApplication(commercial,commercialRepos,ganobot,waRepos,channel,()=> '2026-09-27T12:00:00.000Z'),commercialRepos,waRepos,channel}
}
describe('WhatsApp application',()=>{
 it('resolves tenant, creates identity/conversation and replies',async()=>{const {app,commercialRepos,channel}=setup();const r=await app.ingest({providerMessageId:'wamid.in.1',phoneNumberId:'pn-fl',from:'593999000111',customerName:'Ana',text:'Muéstrame los productos',receivedAt:'2026-09-27T12:00:00.000Z'});expect(r.tenantId).toBe('tenant-floes');expect(r.reply).toBeTruthy();expect(channel.sent).toHaveLength(1);expect(await commercialRepos.identities.resolve('tenant-floes','WHATSAPP','593999000111')).not.toBeNull()})
 it('is idempotent by provider message id',async()=>{const {app,channel}=setup();const input={providerMessageId:'wamid.in.2',phoneNumberId:'pn-fl',from:'593999000222',text:'precio',receivedAt:'2026-09-27T12:00:00.000Z'};expect((await app.ingest(input)).duplicate).toBe(false);expect((await app.ingest(input)).duplicate).toBe(true);expect(channel.sent).toHaveLength(1)})
 it('rejects unknown phone number mapping',async()=>{const {app}=setup();const r=await app.ingest({providerMessageId:'x',phoneNumberId:'unknown',from:'5931',text:'hola',receivedAt:'2026-09-27T12:00:00.000Z'});expect(r.ignored).toBe(true)})
 it('processes Meta webhook shape',async()=>{const {app}=setup();const r=await app.ingestWebhook({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'pn-fl'},messages:[{from:'593999000333',id:'wamid.in.3',timestamp:'1790514000',type:'text',text:{body:'Quiero hablar con un asesor'}}]}}]}]});expect(r).toHaveLength(1);expect(r[0].tenantId).toBe('tenant-floes')})
})
