import { ArrowRight, MessageSquareText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sampleCommercialApp } from '../../application/sampleApp'
import type { Conversation, Customer } from '../../domain'
import { useUIStore } from '../../stores/uiStore'
import { date, tenantNames } from '../commercial/formatters'
import { EmptyState, SampleBadge, StatusPill, TenantFilter } from '../commercial/shared'

export function ConversationsPage() {
  const scope = useUIStore((state) => state.tenantScope)
  const [items, setItems] = useState<readonly Conversation[]>([])
  const [customers, setCustomers] = useState<readonly Customer[]>([])
  const [channel, setChannel] = useState<Conversation['channel'] | ''>('')
  const [status, setStatus] = useState<Conversation['status'] | ''>('')
  const [humanOnly, setHumanOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(() => { setLoading(true); setError(''); void Promise.all([sampleCommercialApp.listConversations(scope, { channel: channel || undefined, status: status || undefined, humanRequired: humanOnly || undefined }), sampleCommercialApp.listCustomers(scope)]).then(([conversations, nextCustomers]) => { setItems(conversations); setCustomers(nextCustomers) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No fue posible cargar conversaciones')).finally(() => setLoading(false)) }, [scope, channel, status, humanOnly])
  useEffect(() => {
  queueMicrotask(load)
}, [load])
  const customerByKey = useMemo(() => new Map(customers.map((item) => [`${item.tenantId}:${item.id}`, item])), [customers])
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">Vista operacional</span><h1>Conversaciones</h1><p>Contexto de conversaciones y asignación comercial. Mensajería externa aún no conectada.</p></div><div className="heading-actions"><SampleBadge /><TenantFilter /></div></div><div className="info-banner">Esta vista no es un inbox: no contiene ni inventa historial de mensajes.</div>
    <div className="filter-bar"><label className="field compact-field"><span>Canal</span><select value={channel} onChange={(event) => setChannel(event.target.value as Conversation['channel'] | '')}><option value="">Todos</option><option>WHATSAPP</option><option>INSTAGRAM</option><option>FACEBOOK</option><option>WEB</option><option>OTHER</option></select></label><label className="field compact-field"><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value as Conversation['status'] | '')}><option value="">Todos</option><option>OPEN</option><option>AUTOMATED</option><option>HUMAN_REQUIRED</option><option>CLOSED</option></select></label><label className="check-field"><input type="checkbox" checked={humanOnly} onChange={(event) => setHumanOnly(event.target.checked)} /> Solo requieren humano</label></div>
    {error && <div className="error-banner">{error} <button onClick={load}>Reintentar</button></div>}{!loading && items.length === 0 ? <EmptyState title="Sin conversaciones" body="Ajusta los filtros para ver otros estados." /> : <section className="conversation-grid">{items.map((item) => <Link className="conversation-card panel" key={item.id} to={`/conversations/${item.tenantId}/${item.id}`}><div className="conversation-icon"><MessageSquareText size={18} /></div><div><strong>{customerByKey.get(`${item.tenantId}:${item.customerId}`)?.name || 'Cliente'}</strong><span>{tenantNames[item.tenantId]} · {item.channel}</span></div><StatusPill value={item.status} /><div className="conversation-meta"><span>Modo</span><strong>{item.assignedMode}</strong><span>Última actividad</span><strong>{date(item.lastActivityAt)}</strong></div><ArrowRight className="card-arrow" size={16} /></Link>)}</section>}
  </div>
}
