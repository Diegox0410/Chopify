import {describe,expect,it} from 'vitest'
import {extractInboundTextMessages,normalizeWhatsAppId,verifyWebhookChallenge} from './whatsapp.js'
describe('WhatsApp domain',()=>{
 it('normalizes ids',()=>expect(normalizeWhatsAppId('+593 99-123-4567')).toBe('593991234567'))
 it('verifies webhook challenge',()=>{expect(verifyWebhookChallenge('subscribe','secret','123','secret')).toBe('123');expect(verifyWebhookChallenge('subscribe','bad','123','secret')).toBeNull()})
 it('extracts only text messages',()=>{const items=extractInboundTextMessages({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'pn'},contacts:[{profile:{name:'Diego'},wa_id:'593991'}],messages:[{from:'593991',id:'wamid.1',timestamp:'1790514000',type:'text',text:{body:'Hola'}}]}}]}]});expect(items).toHaveLength(1);expect(items[0]).toMatchObject({phoneNumberId:'pn',from:'593991',customerName:'Diego',text:'Hola'})})
})
