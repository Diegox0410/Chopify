import { Play, Power, RefreshCw, Workflow } from 'lucide-react'
import { useCallback,useEffect,useState } from 'react'
import { sampleAutomationApp } from '../../application/sampleApp'
import type { AutomationDefinition,OutboxEvent } from '../../domain'
import { useUIStore } from '../../stores/uiStore'
import { EmptyState,SampleBadge,StatusPill,TenantFilter } from '../commercial/shared'
import { tenantNames } from '../commercial/formatters'
const owner={actorId:'platform-owner',role:'PLATFORM_OWNER' as const}
export function AutomationsPage(){
 const scope=useUIStore(s=>s.tenantScope);const [rules,setRules]=useState<readonly AutomationDefinition[]>([]);const [outbox,setOutbox]=useState<readonly OutboxEvent[]>([]);const [error,setError]=useState('')
 const load=useCallback(()=>{setError('');void Promise.all([sampleAutomationApp.listDefinitions(scope),sampleAutomationApp.listOutbox(scope)]).then(([a,o])=>{setRules(a);setOutbox(o)}).catch((e:unknown)=>setError(e instanceof Error?e.message:'No fue posible cargar H4'))},[scope])
 useEffect(()=>{queueMicrotask(load)},[load])
 const simulate=async()=>{const tenant=scope==='ALL'?'tenant-floes':scope;await sampleAutomationApp.processEvent({id:`ui-${Date.now()}`,tenantId:tenant,type:'PAYMENT_CONFIRMED',occurredAt:new Date().toISOString(),entityType:'ORDER',entityId:'sample-order',orderId:'sample-order',customerId:tenant==='tenant-floes'?'cus-fl-1':tenant==='tenant-mg'?'cus-mg-1':'cus-dg-1',data:{channel:'WHATSAPP'}},owner);load()}
 const run=async()=>{await sampleAutomationApp.runPending(scope,owner);load()}
 return <div className="page"><div className="page-heading"><div><span className="eyebrow">Automation engine · H4</span><h1>Automatizaciones</h1><p>Reglas tenant-aware, Policy Engine y Outbox. SEND_MESSAGE_REQUEST todavía no envía mensajes externos.</p></div><div className="heading-actions"><SampleBadge/><TenantFilter/></div></div>
 {error&&<div className="error-banner">{error}</div>}
 <section className="h4-summary"><article><Workflow size={18}/><span>Reglas</span><strong>{rules.length}</strong></article><article><span>Pendientes</span><strong>{outbox.filter(x=>x.status==='PENDING').length}</strong></article><article><span>Enviados SAMPLE</span><strong>{outbox.filter(x=>x.status==='SENT').length}</strong></article><article><span>Fallidos</span><strong>{outbox.filter(x=>['FAILED','DEAD_LETTER'].includes(x.status)).length}</strong></article></section>
 <div className="h4-actions"><button className="secondary-button" onClick={simulate}><Play size={15}/>Simular pago confirmado</button><button className="primary-button" onClick={run}><RefreshCw size={15}/>Procesar Outbox</button></div>
 <section className="panel h4-panel"><div className="panel-header"><div><span className="eyebrow">Rules</span><h2>Reglas por negocio</h2></div></div>{rules.length===0?<EmptyState title="Sin reglas" body="No hay automatizaciones para este alcance."/>:<div className="h4-list">{rules.map(r=><article key={`${r.tenantId}-${r.id}`}><div><strong>{r.name}</strong><small>{tenantNames[r.tenantId]??r.tenantId} · {r.trigger.type} · {r.actions.length} acciones</small></div><StatusPill value={r.status}/><button className="icon-button" aria-label="Pausar o activar" onClick={async()=>{await sampleAutomationApp.toggle(r.tenantId,r.id,owner);load()}}><Power size={15}/></button></article>)}</div>}</section>
 <section className="panel h4-panel"><div className="panel-header"><div><span className="eyebrow">Outbox</span><h2>Observabilidad de ejecución</h2></div></div>{outbox.length===0?<EmptyState title="Outbox vacío" body="Simula un evento para verificar la cadena Trigger → Policy → Outbox."/>:<div className="h4-list">{outbox.slice().reverse().map(o=><article key={o.id}><div><strong>{o.actionType}</strong><small>{tenantNames[o.tenantId]??o.tenantId} · intento {o.attempts}/{o.maxAttempts} · {o.payload.kind}</small></div><StatusPill value={o.status}/></article>)}</div>}</section>
 </div>
}
