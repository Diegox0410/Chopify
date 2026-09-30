import type { WhatsAppConnection,WhatsAppMessage } from '../../domain/index.js'
import type { WhatsAppChannelAdapter,WhatsAppConnectionRepository,WhatsAppMessageRepository } from '../../application/whatsapp.js'

export function createMemoryWhatsAppRepositories(seed:readonly WhatsAppConnection[]=[]){
  const connections:WhatsAppConnection[]=seed.map(x=>({...x}))
  const messages:WhatsAppMessage[]=[]
  const connectionRepo:WhatsAppConnectionRepository={
    async list(scope){return scope==='ALL'?[...connections]:connections.filter(x=>x.tenantId===scope)},
    async resolveByPhoneNumberId(id){return connections.find(x=>x.phoneNumberId===id)??null},
    async save(item){const i=connections.findIndex(x=>x.id===item.id);if(i>=0)connections[i]=item;else connections.push(item)},
  }
  const messageRepo:WhatsAppMessageRepository={
    async findInbound(id){return messages.find(x=>x.direction==='INBOUND'&&x.providerMessageId===id)??null},
    async getByProviderMessageId(id){return messages.find(x=>x.providerMessageId===id)??null},
    async list(scope){return (scope==='ALL'?[...messages]:messages.filter(x=>x.tenantId===scope)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))},
    async save(item){const i=messages.findIndex(x=>x.id===item.id);if(i>=0)messages[i]=item;else messages.push(item)},
  }
  return{connections:connectionRepo,messages:messageRepo}
}
export class SampleWhatsAppAdapter implements WhatsAppChannelAdapter {
  private sequence=0
  readonly sent:Array<{phoneNumberId:string;to:string;text:string}>=[]
  async sendText(input:{phoneNumberId:string;to:string;text:string}){this.sequence++;this.sent.push(input);return{providerMessageId:`wamid.sample.${this.sequence}`}}
}
