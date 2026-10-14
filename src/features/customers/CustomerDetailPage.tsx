import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { conversationDate, conversationRequest, conversationStatus, type CustomerContext } from '../conversations/conversationApi'

export function CustomerDetailPage() {
  const { tenantId = '', customerId = '' } = useParams()
  const [context, setContext] = useState<CustomerContext | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setContext(await conversationRequest<CustomerContext>(tenantId, {view:'customer',customerId,limit:25})); setError('') }
    catch (cause) { setContext(null); setError(cause instanceof Error ? cause.message : 'Ficha no disponible') }
  }, [tenantId, customerId])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  return <div className="page"><Link to="/customers">Volver a clientes</Link><div className="page-heading"><div><span className="eyebrow">Ficha CRM · {tenantId}</span><h1>{context?.customer.name || 'Cliente'}</h1><p>{context?.customer.phone || context?.customer.email || 'Datos de contacto no disponibles'}</p></div><button className="secondary-button" onClick={() => void load()}>Actualizar</button></div>{error && <div className="error-banner" role="alert">{error}</div>}{context && <>
    <section className="panel"><h2>Canales y origen</h2><p>Origen: {context.customer.acquisitionSource || 'Sin atribución verificada'}</p><p>Estado: {context.customer.status}</p>{context.customer.identities?.map(identity => <p key={`${identity.channel}:${identity.externalIdentifier}`}>{identity.channel} · identidad registrada</p>)}</section>
    <section className="panel admin-record-list"><h2>Conversaciones e historial completo</h2><p>Cada hilo abre los mismos mensajes persistidos que usa la bandeja.</p>{context.conversations.length ? context.conversations.map(item => <article key={item.id}><header><Link to={`/conversations/${tenantId}/${item.id}`}>{item.channel} · {item.contact}</Link><span>{conversationStatus(item.status)}</span></header><p>{item.lastMessage}</p><small>{conversationDate(item.lastActivityAt)}</small></article>) : <p>No hay conversaciones vinculadas mediante una identidad verificada.</p>}</section>
    <section className="panel admin-record-list"><h2>Pedidos y pagos</h2>{context.commerce.orders.length ? context.commerce.orders.map(order => <article key={order.id}><header><Link to="/orders">{order.id}</Link><span>{new Intl.NumberFormat('es-EC',{style:'currency',currency:order.currency}).format(order.grandTotalCents / 100)}</span></header><p>Pago: {order.paymentStatus} · Operación: {order.fulfillmentStatus}</p>{order.followUp && <p>Postventa: {order.followUp.outcome} {order.followUp.note}</p>}</article>) : <p>Sin pedidos asociados.</p>}</section>
    <section className="panel"><h2>Actividad, consultas y seguimiento</h2>{context.commerce.activities.length ? context.commerce.activities.map(item => <p key={item.id}>{item.summary || item.type || 'Evento persistido'} · {conversationDate(item.occurredAt || item.createdAt)}</p>) : <p>Sin actividad registrada.</p>}<h3>Notas internas</h3>{context.commerce.notes.length ? context.commerce.notes.map(note => <p key={note.id}>{note.body} · {conversationDate(note.createdAt)}</p>) : <p>Sin notas registradas.</p>}</section>
  </>}</div>
}
