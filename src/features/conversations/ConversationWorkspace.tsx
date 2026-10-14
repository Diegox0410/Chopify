import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { tenantDefinitions, tenantIds } from '../../config/tenantRegistry.js'
import { conversationDate, conversationRequest, conversationStatus, type ConversationActionResult, type ConversationList, type ConversationThread, type LiveConversation } from './conversationApi'
import './conversations.css'

const sender = { CLIENT: 'Cliente', GANOBOT: 'GanoBot', HUMAN: 'Operador', SYSTEM: 'Sistema' }
const delivery = { ACCEPTED: 'Aceptado por Meta', SENT: 'Enviado', DELIVERED: 'Entregado', READ: 'Leído', FAILED: 'Falló la entrega' }
export function ConversationWorkspace({ initialTenant = 'tenant-floes', initialConversation = '' }: { initialTenant?: string; initialConversation?: string }) {
  const [tenant, setTenant] = useState(initialTenant)
  const [list, setList] = useState<ConversationList | null>(null)
  const [selected, setSelected] = useState(initialConversation)
  const [thread, setThread] = useState<ConversationThread | null>(null)
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('')
  const [filters, setFilters] = useState({ query: '', status: '' })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [text, setText] = useState(''); const [notice, setNotice] = useState('')
  const [auto, setAuto] = useState(false); const [ambiguous, setAmbiguous] = useState(false)
  const requestRevision = useRef(0)
  const loadList = useCallback(async (cursor?: string) => {
    const result = await conversationRequest<ConversationList>(tenant, { view: 'list', query: filters.query, status: filters.status, limit: 25, cursor })
    setList(old => cursor && old ? { ...result, conversations: [...old.conversations, ...result.conversations.filter(row => !old.conversations.some(item => item.id === row.id))] } : result)
  }, [tenant, filters])
  const loadThread = useCallback(async (id: string, before?: string) => {
    const revision = ++requestRevision.current
    const result = await conversationRequest<ConversationThread>(tenant, { view: 'thread', conversationId: id, limit: 30, before })
    if (revision !== requestRevision.current) return
    setThread(old => before && old?.conversation.id === id ? { ...result, timeline: [...result.timeline.filter(event => !old.timeline.some(item => item.id === event.id)), ...old.timeline] } : result)
  }, [tenant])
  const refresh = useCallback(async () => {
    setBusy(true); setError('')
    try { await loadList(); if (selected) await loadThread(selected) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Datos no disponibles') }
    finally { setBusy(false) }
  }, [loadList, loadThread, selected])
  useEffect(() => { const timer = window.setTimeout(() => { void loadList().catch(cause => setError(cause instanceof Error ? cause.message : 'Datos no disponibles')) }, 0); return () => window.clearTimeout(timer) }, [loadList])
  useEffect(() => { if (!selected) return; const timer = window.setTimeout(() => { void loadThread(selected).catch(cause => setError(cause instanceof Error ? cause.message : 'Hilo no disponible')) }, 0); return () => { window.clearTimeout(timer) } }, [selected, loadThread])
  useEffect(() => { if (!auto || !selected) return; const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadThread(selected).catch(() => setError('No se pudo actualizar el hilo.')) }, 30000); return () => window.clearInterval(timer) }, [auto, selected, loadThread])
  async function action(name: string, row: LiveConversation, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await conversationRequest<ConversationActionResult>(tenant, {}, { action: name, conversationId: row.id, idempotencyKey: crypto.randomUUID(), ...extra })
      if (name === 'send-human') { if (result.status === 'ACCEPTED') { setText(''); setNotice('Meta aceptó el mensaje. La entrega se confirma en el historial.'); setAmbiguous(false) } else { setAmbiguous(result.status === 'UNKNOWN'); setNotice(result.status === 'UNKNOWN' ? 'Envío incierto. Revisa el historial antes de intentar otra respuesta.' : result.reason || 'Envío bloqueado.') } }
      await loadThread(row.id); await loadList()
    } catch (cause) { if (name === 'send-human') setAmbiguous(true); setError(cause instanceof Error ? cause.message : 'Operación no disponible') }
    finally { setBusy(false) }
  }
  function choose(row: LiveConversation) { requestRevision.current++; if (row.id === selected) void loadThread(row.id).catch(cause => setError(String(cause))); setSelected(row.id); setThread(null); setText(''); setNotice(''); setAmbiguous(false); if (row.unreadCount) void action('mark-read', row) }
  const row = thread?.conversation
  return <div className="page live-inbox-page">
    <div className="page-heading"><div><span className="eyebrow">CRM · mensajes persistidos</span><h1>Conversaciones</h1><p>Cliente, IA y operadores comparten el mismo historial.</p></div><div className="heading-actions"><label>Negocio <select aria-label="Negocio" value={tenant} onChange={event => { requestRevision.current++; setTenant(event.target.value); setList(null); setThread(null); setSelected('') }}>{tenantIds.map(id => <option key={id} value={id}>{tenantDefinitions[id].name}</option>)}</select></label><button className="secondary-button" disabled={busy} onClick={() => void refresh()}>Actualizar</button></div></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="live-inbox-layout">
      <aside className="panel live-inbox-list"><form onSubmit={event => { event.preventDefault(); setFilters({query, status}) }}><label>Buscar<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cliente o mensaje" /></label><label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option>{['AI_ATTENDING','WAITING_CUSTOMER','REQUIRES_HUMAN','HUMAN_ATTENDING','CLOSED'].map(value => <option key={value} value={value}>{conversationStatus(value)}</option>)}</select></label><button className="secondary-button" type="submit">Aplicar</button></form>
        {list?.coverage === 'INDEXED_AND_RECENT_LEGACY' && <p className="live-inbox-hint">Incluye eventos históricos recientes. Los hilos antiguos requieren completar su índice.</p>}
        {!list ? <p>Cargando conversaciones…</p> : !list.conversations.length ? <p>Sin conversaciones en esta página.</p> : list.conversations.map(item => <button type="button" className={`live-inbox-item ${item.id === selected ? 'is-selected' : ''}`} key={item.id} onClick={() => choose(item)}><strong>{item.contact}</strong><small>{item.channel} · {conversationDate(item.lastActivityAt)}</small><span>{item.lastMessage || 'Sin texto'}</span><small>{conversationStatus(item.status)}{item.unreadCount > 0 && ` · ${item.unreadCount} nuevos`}</small></button>)}
        {list?.nextCursor && <button className="secondary-button" disabled={busy} onClick={() => void loadList(list.nextCursor).catch(cause => setError(String(cause)))}>Cargar anteriores</button>}
      </aside>
      <section className="panel live-inbox-thread" aria-label="Historial de conversación">
        {!row || !thread ? <p>{selected ? 'Cargando hilo…' : 'Selecciona una conversación.'}</p> : <><header><h2>{row.contact}</h2><p>{row.maskedPhone} · {conversationStatus(row.status)}</p><div className="heading-actions">{row.mode === 'HUMAN' ? <button className="secondary-button" disabled={busy} onClick={() => void action('release', row)}>Devolver a GanoBot</button> : row.mode === 'CLOSED' ? <button className="secondary-button" disabled={busy} onClick={() => void action('reopen', row)}>Reabrir</button> : <button className="primary-button" disabled={busy} onClick={() => void action('take', row)}>Tomar control</button>}{row.mode !== 'CLOSED' && <button className="secondary-button" disabled={busy} onClick={() => { const reason = window.prompt('Motivo de cierre'); if (reason?.trim()) void action('close', row, { reason }) }}>Cerrar</button>}<button className="secondary-button" disabled={busy} onClick={() => void action('mark-read', row)}>Marcar leída</button></div><label className="live-inbox-auto"><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} /> Actualizar este hilo cada 30 s</label></header>
          {thread.nextCursor && <button className="secondary-button" onClick={() => void loadThread(row.id, thread.nextCursor).catch(cause => setError(String(cause)))}>Mensajes anteriores</button>}
          <ol className="live-inbox-messages">{thread.timeline.map(event => <li className={`live-message live-message-${event.direction.toLowerCase()}`} key={event.id}><small>{sender[event.senderType]} · {conversationDate(event.createdAt)}</small><p>{event.text || event.action || event.status}</p>{event.attachments.map((asset,index) => asset.type === 'IMAGE' && asset.url ? <figure key={index}><img src={asset.url} alt={asset.caption || 'Fotografía del catálogo consultado'} loading="lazy" /><figcaption>{asset.caption}</figcaption></figure> : <p key={index}>Comprobante privado · revisar en Pagos</p>)}{event.deliveryStatus && <small>{delivery[event.deliveryStatus as keyof typeof delivery] || event.deliveryStatus}</small>}{event.technicalReason && <small>Diagnóstico: {event.technicalReason}</small>}{event.reason && <small>Motivo: {event.reason}</small>}</li>)}</ol>
          {row.mode === 'HUMAN' && <form className="live-inbox-composer" onSubmit={event => { event.preventDefault(); if (window.confirm(`Enviar esta respuesta a ${row.maskedPhone} por WhatsApp?`)) void action('send-human', row, { text }) }}><label>Respuesta humana<textarea value={text} maxLength={4000} disabled={ambiguous} onChange={event => setText(event.target.value)} /></label><button className="primary-button" disabled={busy || ambiguous || !text.trim()}>Enviar por WhatsApp</button>{ambiguous && <p>El resultado del envío es incierto. Revisa los estados persistidos antes de escribir otro mensaje.</p>}</form>}
          {notice && <p role="status">{notice}</p>}
        </>}
      </section>
      <aside className="panel live-inbox-customer"><h2>Cliente y operación</h2>{row && thread && <><p>{thread.customer?.name || row.contact}</p><p>{thread.customer?.phone || row.maskedPhone}</p><p>{thread.customer?.email || 'Sin correo registrado'}</p><p>Origen: {thread.customer?.acquisitionSource || row.origin || 'No verificado'}</p><p>Responsable: {row.assignedTo || 'Sin asignar'}</p>{thread.customer && <Link to={`/customers/${tenant}/${thread.customer.id}`}>Abrir ficha completa</Link>}<h3>Productos consultados</h3><p>{thread.commerce.productInterests?.join(' · ') || 'Sin interés persistido'}</p><h3>Pedidos</h3>{thread.commerce.orders.length ? thread.commerce.orders.map(order => <article key={order.id}><Link to="/orders">{order.id}</Link><p>Pago: {order.paymentStatus}</p><p>Operación: {order.fulfillmentStatus}</p>{order.followUp && <p>Postventa: {order.followUp.outcome}</p>}</article>) : <p>Sin pedidos asociados.</p>}<h3>Actividad comercial</h3>{thread.commerce.activities.map(item => <p key={item.id}>{item.summary || item.type || 'Evento registrado'} · {conversationDate(item.occurredAt || item.createdAt)}</p>)}</>}</aside>
    </div>
  </div>
}
