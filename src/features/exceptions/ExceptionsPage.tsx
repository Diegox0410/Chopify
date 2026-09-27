import { AlertTriangle, ArrowRight, CreditCard, PackageX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sampleOrderApp } from '../../application/sampleApp'
import type { Order } from '../../domain'
import { useUIStore } from '../../stores/uiStore'
import { money, tenantNames } from '../commercial/formatters'
import { EmptyState, SampleBadge, StatusPill, TenantFilter } from '../commercial/shared'
type Review = Awaited<ReturnType<typeof sampleOrderApp.paymentReviews>>[number]
export function ExceptionsPage() {
 const scope=useUIStore((s)=>s.tenantScope); const [orders,setOrders]=useState<readonly Order[]>([]); const [reviews,setReviews]=useState<readonly Review[]>([]); const [error,setError]=useState('')
 const load=useCallback(()=>{setError('');void Promise.all([sampleOrderApp.listOrders(scope),sampleOrderApp.paymentReviews(scope)]).then(([o,r])=>{setOrders(o);setReviews(r)}).catch((c:unknown)=>setError(c instanceof Error?c.message:'No fue posible cargar excepciones'))},[scope])
 useEffect(()=>{queueMicrotask(load)},[load]); const rejected=useMemo(()=>orders.filter((x)=>x.paymentStatus==='REJECTED'),[orders]); const attention=reviews.length+rejected.length
 return <div className="page"><div className="page-heading"><div><span className="eyebrow">Exception center · H3</span><h1>Excepciones operativas</h1><p>Pedidos y pagos que requieren decisión humana. No ejecuta automatizaciones externas.</p></div><div className="heading-actions"><SampleBadge/><TenantFilter/></div></div>
 {error&&<div className="error-banner">{error} <button onClick={load}>Reintentar</button></div>}
 <section className="h3-summary-grid"><article><AlertTriangle size={18}/><span>Requieren atención</span><strong>{attention}</strong></article><article><CreditCard size={18}/><span>Pagos por verificar</span><strong>{reviews.length}</strong></article><article><PackageX size={18}/><span>Pagos rechazados</span><strong>{rejected.length}</strong></article><article><span className="h3-dot success"/><span>Pedidos visibles</span><strong>{orders.length}</strong></article></section>
 <section className="panel h3-exception-list">{attention===0?<EmptyState title="Sin excepciones H3" body="No hay pagos pendientes de revisión ni rechazados."/>:<>{reviews.map(({order,payment,proof})=><article className="h3-exception-row" key={proof.id}><div><span className="eyebrow">{tenantNames[order.tenantId]??order.tenantId}</span><strong>Verificar comprobante · {order.id}</strong><small>{proof.reference||proof.id} · {money(payment.amountCents,payment.currency)}</small></div><StatusPill value={payment.status}/><Link className="text-link" to="/payments/review">Revisar <ArrowRight size={14}/></Link></article>)}{rejected.map((order)=><article className="h3-exception-row" key={order.id}><div><span className="eyebrow">{tenantNames[order.tenantId]??order.tenantId}</span><strong>Pago rechazado · {order.id}</strong><small>Puede recibirse un comprobante de reemplazo.</small></div><StatusPill value={order.paymentStatus}/><Link className="text-link" to={`/orders/${order.tenantId}/${order.id}`}>Abrir <ArrowRight size={14}/></Link></article>)}</>}</section></div>
}