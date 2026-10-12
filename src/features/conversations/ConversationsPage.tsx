import { MessageSquareText, RefreshCw, Send, UserRoundCheck, Bot } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState, StatusPill } from '../commercial/shared'
import { auth } from '../../auth/firebaseClient'
import { tenantDefinitions, tenantIds } from '../../config/tenantRegistry.js'
import { adminApi } from '../admin/adminApi'
import { useVisiblePolling } from '../../hooks/useVisiblePolling'

type Event = { id: string; direction: 'INBOUND'|'OUTBOUND'|'EVENT'; senderType?: string; text: string; createdAt: string; status: string }
type LiveConversation = { id: string; tenantId: string; channel: 'WHATSAPP'; contact: string; maskedPhone: string; lastActivityAt: string; messageCount: number; timeline: readonly Event[]; status: string; mode: string; requiresHuman: boolean; escalationReason: string; unreadCount: number; assignedTo: string; outbound: { status: string; attempts: number }|null; selection: { model: string; color: string; size: string }|null; opportunity: { id:string; status:string; intent:string }|null; order: { id: string; status: string; fulfillmentStatus: string; paymentStatus: string; customerId: string }|null; payment: { status: string; proofId: string; paymentId: string }|null; alerts: readonly string[]; orderPath: string }
type Snapshot = { conversations: readonly LiveConversation[]; nextCursor?: string; alerts: readonly { id:string; type:string; summary:string; href:string; read:boolean; createdAt:string }[]; unreadAlertCount:number }
type Filter = 'ALL'|'NEW'|'BOT'|'HUMAN'|'PAYMENT'|'PREPARING'|'READY'|'DISPATCHED'|'CLOSED'
const date=(value:string)=>value?new Intl.DateTimeFormat('es-EC',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Sin fecha'
const priority=(item:LiveConversation)=>item.requiresHuman?0:item.unreadCount>0?1:item.payment?.status==='PENDING'?2:item.order?.fulfillmentStatus==='READY'?3:4
const textHash=(value:string)=>{let hash=2166136261;for(let index=0;index<value.length;index+=1)hash=Math.imul(hash^value.charCodeAt(index),16777619);return(hash>>>0).toString(16)}

export function ConversationsPage(){
  const [tenant,setTenant]=useState('tenant-floes')
  const [items,setItems]=useState<readonly LiveConversation[]>([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [filter,setFilter]=useState<Filter>('ALL')
  const [search,setSearch]=useState('')
  const [expanded,setExpanded]=useState('')
  const [reply,setReply]=useState<Record<string,string>>({})
  const [busy,setBusy]=useState('')
  const [nextCursor,setNextCursor]=useState('')

  const load=useCallback(async(cursor?:string)=>{
    setLoading(true);setError('')
    try{
      const body=await adminApi<Snapshot>('commandCenterSnapshot',tenant,cursor?{cursor}:{})
      setItems(current=>cursor?[...current,...body.conversations.filter(item=>!current.some(existing=>existing.id===item.id))]:body.conversations)
      setNextCursor(body.nextCursor||'')
      return true
    }catch(cause){setItems([]);setError(cause instanceof Error?cause.message:'No fue posible cargar conversaciones reales.');return false}
    finally{setLoading(false)}
  },[tenant])

  useVisiblePolling(load,30_000)

  async function action(item:LiveConversation,name:string,text?:string){
    setBusy(item.id);setError('')
    try{
      const user=auth.currentUser
      if(!user)throw new Error('La sesión administrativa no está disponible.')
      const idToken=await user.getIdToken()
      const storageKey=name==='reply'&&text?`whatsapp-reply:${item.id}:${textHash(text.trim())}`:''
      const idempotencyKey=storageKey?(sessionStorage.getItem(storageKey)||crypto.randomUUID()):undefined
      if(storageKey&&idempotencyKey)sessionStorage.setItem(storageKey,idempotencyKey)
      const response=await fetch('/api/conversations',{method:'POST',headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${idToken}`},body:JSON.stringify({tenantId:item.tenantId,conversationId:item.id,action:name,...(text?{text}:{}),...(idempotencyKey?{idempotencyKey}:{})})})
      const body=await response.json()
      if(!response.ok||body.ok===false)throw new Error(body.error||`No fue posible completar ${name}.`)
      if(name==='reply'){if(storageKey)sessionStorage.removeItem(storageKey);setReply(current=>({...current,[item.id]:''}))}
      await load()
    }catch(cause){setError(cause instanceof Error?cause.message:'No fue posible completar la acción.')}
    finally{setBusy('')}
  }

  async function commerceAction(item:LiveConversation,operation:string,input:Record<string,unknown>){
    setBusy(item.id);setError('')
    try{await adminApi(operation,item.tenantId,input,crypto.randomUUID());await load()}
    catch(cause){setError(cause instanceof Error?cause.message:'No fue posible completar la acción comercial.')}
    finally{setBusy('')}
  }

  const visible=useMemo(()=>items.filter(item=>{
    const matchesFilter=filter==='ALL'||filter==='NEW'&&item.unreadCount>0||filter==='BOT'&&item.mode==='GANOBOT_LIVE'||filter==='HUMAN'&&item.requiresHuman||filter==='PAYMENT'&&item.payment?.status==='PENDING'||filter==='PREPARING'&&item.order?.fulfillmentStatus==='PREPARING'||filter==='READY'&&item.order?.fulfillmentStatus==='READY'||filter==='DISPATCHED'&&item.order?.fulfillmentStatus==='DISPATCHED'||filter==='CLOSED'&&['CLOSED','RESOLVED'].includes(item.mode)
    const needle=search.trim().toLowerCase()
    const matchesSearch=!needle||`${item.contact} ${item.timeline.at(-1)?.text||''}`.toLowerCase().includes(needle)
    return matchesFilter&&matchesSearch
  }).sort((a,b)=>priority(a)-priority(b)||b.lastActivityAt.localeCompare(a.lastActivityAt)),[items,filter,search])
  const needsAttention=items.filter(item=>item.requiresHuman).length

  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Operación real · actualiza cada 30 s cuando está visible</span><h1>Conversaciones</h1><p>Una cápsula por cliente, con prioridad para atención humana y mensajes nuevos.</p></div>
      <div className="heading-actions"><label className="field"><span>Negocio</span><select value={tenant} onChange={event=>setTenant(event.target.value)}>{tenantIds.map(id=><option key={id} value={id}>{tenantDefinitions[id].name}</option>)}</select></label><button className="secondary-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/>{loading?'Actualizando...':'Actualizar'}</button></div>
    </div>
    {error&&<div className="error-banner">{error}<button onClick={()=>void load()}>Reintentar</button></div>}
    <div className="h3-summary-grid"><article><UserRoundCheck size={18}/><span>Requieren atención</span><strong>{needsAttention}</strong></article><article><MessageSquareText size={18}/><span>Mensajes nuevos</span><strong>{items.reduce((sum,item)=>sum+item.unreadCount,0)}</strong></article><article><Bot size={18}/><span>En GanoBot</span><strong>{items.filter(item=>item.mode==='GANOBOT_LIVE').length}</strong></article><article><span>Conversaciones</span><strong>{items.length}</strong></article></div>
    {nextCursor&&<div className="heading-actions"><button className="secondary-button" disabled={loading} onClick={()=>void load(nextCursor)}>{loading?'Cargando...':'Cargar 25 conversaciones anteriores'}</button></div>}
    <section className="panel h3-filter-panel"><label className="h3-search"><MessageSquareText size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar cliente, teléfono o mensaje reciente"/></label><select value={filter} onChange={event=>setFilter(event.target.value as Filter)} aria-label="Filtrar conversaciones"><option value="ALL">Todas</option><option value="NEW">Nuevas</option><option value="BOT">GanoBot</option><option value="HUMAN">Atención humana</option><option value="PAYMENT">Pago pendiente</option><option value="PREPARING">Preparando</option><option value="READY">Listo</option><option value="DISPATCHED">Enviado</option><option value="CLOSED">Cerradas</option></select></section>
    {visible.length===0?<EmptyState title="Sin conversaciones" body={`Cuando llegue un mensaje de ${tenantDefinitions[tenant].name} aparecerá aquí.`}/>:<section className="stack-list">
      {visible.map(item=>{const isOpen=expanded===item.id;return <article className="panel detail-panel" key={item.id}>
        <div className="section-heading"><div><span className="eyebrow">{item.channel} · {item.contact} {item.maskedPhone&&`· ${item.maskedPhone}`}</span><h2>{item.timeline.at(-1)?.text||'Conversación'}</h2><small>{date(item.lastActivityAt)} · {item.messageCount} mensajes · {item.unreadCount?`${item.unreadCount} nuevos`: 'Leída'} · {item.assignedTo?'Asignada':'Sin asignar'}</small></div><div><StatusPill value={item.requiresHuman?'NEEDS HUMAN':item.mode}/></div></div>
        <section className="conversation-commerce-summary" aria-label="Resumen operativo"><div><span>Selección actual</span><strong>{item.selection?[item.selection.model,item.selection.color,item.selection.size].filter(Boolean).join(' · '):'Sin selección registrada'}</strong></div><div><span>Oportunidad</span><strong>{item.opportunity?`${item.opportunity.intent} · ${item.opportunity.status}`:'Sin oportunidad activa'}</strong></div><div><span>Pedido</span><strong>{item.order?`${item.order.id} · ${item.order.status}`:'No existe'}</strong></div><div><span>Pago</span><strong>{item.payment?.status==='PENDING'?'Pendiente':item.payment?.status==='APPROVED'?'Aprobado':item.payment?.status==='REJECTED'?'Rechazado':item.payment?.status==='NOT_RECEIVED'?'No recibido':'—'}</strong></div><div><span>Operación</span><strong>{item.order?.fulfillmentStatus||'—'}</strong></div>{item.alerts.length>0&&<div className="conversation-alert-list"><span>Alertas operativas</span><strong>{item.alerts.join(' · ')}</strong></div>}</section>
        <div className="heading-actions"><button className="secondary-button" onClick={()=>{setExpanded(isOpen?'':item.id);if(!isOpen&&item.unreadCount)void action(item,'mark-read')}}>{isOpen?'Ocultar hilo':'Abrir hilo'}</button>{!['HUMAN','CLOSED','RESOLVED'].includes(item.mode)&&<button className="primary-button" disabled={busy===item.id} onClick={()=>void action(item,'take')}><UserRoundCheck size={15}/> Tomar conversación</button>}{item.mode==='HUMAN'&&<button className="secondary-button" disabled={busy===item.id} onClick={()=>void action(item,'release')}><Bot size={15}/> Devolver a GanoBot</button>}{['CLOSED','RESOLVED'].includes(item.mode)&&<button className="primary-button" disabled={busy===item.id} onClick={()=>void action(item,'reopen')}>Reabrir</button>}{!['CLOSED','RESOLVED'].includes(item.mode)&&<button className="secondary-button" disabled={busy===item.id} onClick={()=>void action(item,'resolve')}>Resolver</button>}{item.mode!=='CLOSED'&&<button className="secondary-button danger" disabled={busy===item.id} onClick={()=>void action(item,'close')}>Cerrar</button>}</div>
        {item.requiresHuman&&<div className="error-banner">Requiere atención · {item.escalationReason||'Motivo no registrado'}</div>}
        {isOpen&&<><ol className="conversation-timeline">{item.timeline.map(event=><li className={event.direction==='EVENT'?'conversation-event':''} key={event.id}><span>{event.senderType|| (event.direction==='INBOUND'?'CLIENTE':'GANOBOT')} · {date(event.createdAt)}</span><p>{event.text||event.status}</p></li>)}</ol><div className="heading-actions">{item.order&&<a className="secondary-button" href={item.orderPath}>Ver pedido</a>}{item.payment?.proofId&&<a className="secondary-button" href="/payments">Ver comprobante</a>}{item.payment?.status==='PENDING'&&item.payment.paymentId&&item.order&&<button className="primary-button" disabled={busy===item.id} onClick={()=>void commerceAction(item,'approvePayment',{paymentId:item.payment!.paymentId,proofId:item.payment!.proofId})}>Aprobar pago</button>}{item.order?.fulfillmentStatus==='PREPARING'&&<button className="primary-button" disabled={busy===item.id} onClick={()=>void commerceAction(item,'markReady',{orderId:item.order!.id})}>Marcar listo</button>}{item.order?.fulfillmentStatus==='READY'&&<button className="primary-button" disabled={busy===item.id} onClick={()=>void commerceAction(item,'dispatchOrder',{orderId:item.order!.id})}>Marcar enviado</button>}{item.order?.fulfillmentStatus==='DISPATCHED'&&<button className="primary-button" disabled={busy===item.id} onClick={()=>void commerceAction(item,'markDelivered',{orderId:item.order!.id})}>Marcar entregado</button>}</div>{item.mode==='HUMAN'&&<div className="heading-actions"><textarea aria-label="Respuesta humana" value={reply[item.id]||''} onChange={event=>setReply(current=>({...current,[item.id]:event.target.value}))} placeholder="Escribe una respuesta para WhatsApp"/><button className="primary-button" disabled={busy===item.id||!(reply[item.id]||'').trim()} onClick={()=>void action(item,'reply',reply[item.id])}><Send size={15}/> Enviar por WhatsApp</button></div>}</>}
      </article>})}
    </section>}
  </div>
}
