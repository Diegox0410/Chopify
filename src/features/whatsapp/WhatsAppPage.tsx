import {useEffect,useState} from 'react'
import {MessageCircle,Play,Radio,ShieldCheck} from 'lucide-react'
import {sampleWhatsAppApp} from '../../application/sampleApp'
import {SampleBadge,TenantFilter} from '../commercial/shared'
import {useUIStore} from '../../stores/uiStore'
export function WhatsAppPage(){
 const scope=useUIStore(s=>s.tenantScope);const tenantId=scope==='ALL'?'tenant-floes':scope
 const [connections,setConnections]=useState<Awaited<ReturnType<typeof sampleWhatsAppApp.listConnections>>>([])
 const [messages,setMessages]=useState<Awaited<ReturnType<typeof sampleWhatsAppApp.listMessages>>>([])
 const [text,setText]=useState('Quiero comprar un scrub');const [busy,setBusy]=useState(false);const [last,setLast]=useState('')
 useEffect(()=>{
  let active=true
  void Promise.all([sampleWhatsAppApp.listConnections(tenantId),sampleWhatsAppApp.listMessages(tenantId)]).then(([nextConnections,nextMessages])=>{
   if(!active)return
   setConnections(nextConnections);setMessages(nextMessages)
  })
  return()=>{active=false}
 },[tenantId])
 const refresh=async()=>{const [nextConnections,nextMessages]=await Promise.all([sampleWhatsAppApp.listConnections(tenantId),sampleWhatsAppApp.listMessages(tenantId)]);setConnections(nextConnections);setMessages(nextMessages)}
 const simulate=async()=>{setBusy(true);try{const connection=(await sampleWhatsAppApp.listConnections(tenantId))[0];if(!connection){setLast('Sin conexión configurada');return}const result=await sampleWhatsAppApp.ingest({providerMessageId:`wamid.ui.${Date.now()}`,phoneNumberId:connection.phoneNumberId,from:'593990001234',customerName:'Cliente WhatsApp SAMPLE',text,receivedAt:new Date().toISOString()});setLast(result.reply??result.reason??'Procesado');await refresh()}finally{setBusy(false)}}
 return <main className="h9-page"><div className="commercial-page-head"><div><span className="eyebrow">H9 · WHATSAPP</span><h1>WhatsApp</h1><p>Ingress multi-tenant, identidad, idempotencia, GanoBot y outbound. La UI usa adapter SAMPLE; el adapter Meta queda en la frontera externa.</p></div><div className="commercial-head-actions"><SampleBadge/><TenantFilter/></div></div><section className="h9-grid"><div className="commercial-card h9-card"><div className="h9-title"><Radio/>Conexión</div>{connections.map(c=><div className="h9-connection" key={c.id}><div><strong>{c.displayPhone??c.phoneNumberId}</strong><small>{c.phoneNumberId}</small></div><span>{c.status}</span></div>)}<div className="h8-guard"><ShieldCheck/>phone_number_id resuelve el negocio. Un comprobante nunca confirma el pago automáticamente.</div></div><div className="commercial-card h9-card"><div className="h9-title"><MessageCircle/>Webhook simulator</div><textarea rows={4} value={text} onChange={e=>setText(e.target.value)}/><button className="primary-action" onClick={simulate} disabled={busy}><Play/>{busy?'Procesando…':'Simular inbound'}</button>{last&&<p className="h9-result">{last}</p>}</div></section><section className="commercial-card h9-messages"><div className="h9-title"><MessageCircle/>Mensajes procesados</div>{messages.length===0?<div className="commercial-empty"><strong>Sin mensajes</strong><p>Simula un inbound para validar el pipeline.</p></div>:messages.slice(0,20).map(m=><div className="h9-row" key={m.id}><span>{m.direction}</span><strong>{m.status}</strong><p>{m.text}</p><small>{m.providerMessageId??'sin provider id'}</small></div>)}</section></main>
}
