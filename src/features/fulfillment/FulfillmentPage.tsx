import { CheckCircle2, PackageCheck, Send, Truck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Order } from '../../domain'
import { useUIStore } from '../../stores/uiStore'
import { date, money, tenantNames } from '../commercial/formatters'
import { EmptyState, StatusPill, TenantFilter } from '../commercial/shared'
import { orderNumber } from '../orders/operational'
import { adminApi, adminApiForScope, adminOperationKey } from '../admin/adminApi'

export function FulfillmentPage() {
  const scope = useUIStore((state) => state.tenantScope)
  const [items, setItems] = useState<readonly Order[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [shipping, setShipping] = useState<Record<string,{courier:string;trackingCode:string}>>({})
  const load = useCallback(() => {
    setError('')
    void adminApiForScope<Order>('listOrders', scope).then(setItems).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar fulfillment'))
  }, [scope])
  useEffect(() => { queueMicrotask(load) }, [load])
  const queue = useMemo(() => items.filter((item) => item.paymentStatus === 'PAID' && !['DELIVERED','CANCELLED'].includes(item.fulfillmentStatus)), [items])

  async function run(order: Order, action: () => Promise<unknown>) {
    setBusy(order.id); setError('')
    try { await action(); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible avanzar fulfillment') }
    finally { setBusy('') }
  }

  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Fulfillment operations</span><h1>Preparación y entrega</h1><p>La cola logística contiene pedidos reales con pago confirmado.</p></div><div className="heading-actions"><TenantFilter/></div></div>
    {error && <div className="error-banner">{error}</div>}
    <section className="h3-summary-grid"><article><PackageCheck size={18}/><span>En cola</span><strong>{queue.length}</strong></article><article><span className="h3-dot warning"/><span>Por preparar</span><strong>{queue.filter((x)=>x.fulfillmentStatus==='UNFULFILLED').length}</strong></article><article><Truck size={18}/><span>Listos</span><strong>{queue.filter((x)=>x.fulfillmentStatus==='READY').length}</strong></article><article><Send size={18}/><span>Despachados</span><strong>{queue.filter((x)=>x.fulfillmentStatus==='DISPATCHED').length}</strong></article></section>
    <section className="panel h3-fulfillment-list">{queue.length===0 ? <EmptyState title="Sin pedidos logísticos" body="No hay pedidos pagados pendientes de entrega."/> : queue.map((order) => {
      const dispatch = shipping[order.id] ?? {courier:'',trackingCode:''}
      return <article className="h3-fulfillment-card" key={`${order.tenantId}-${order.id}`}>
        <div><span className="eyebrow">{tenantNames[order.tenantId] ?? order.tenantId}</span><Link to={`/orders/${order.tenantId}/${order.id}`}><strong>{orderNumber(order)}</strong></Link><small>{order.items.map((x)=>`${x.quantity}× ${x.productName}`).join(' · ')} · {money(order.grandTotalCents,order.currency)} · {date(order.updatedAt)}</small></div>
        <StatusPill value={order.fulfillmentStatus}/>
        <div className="h3-fulfillment-action">
          {order.fulfillmentStatus==='UNFULFILLED' && <button className="primary-button" disabled={busy===order.id} onClick={()=>run(order,()=>adminApi('startPreparation',order.tenantId,{orderId:order.id},adminOperationKey('prepare',order.id)))}><PackageCheck size={16}/> Iniciar preparación</button>}
          {order.fulfillmentStatus==='PREPARING' && <button className="primary-button" disabled={busy===order.id} onClick={()=>run(order,()=>adminApi('markReady',order.tenantId,{orderId:order.id},adminOperationKey('ready',order.id)))}><CheckCircle2 size={16}/> Marcar listo</button>}
          {order.fulfillmentStatus==='READY' && <div className="h3-dispatch-form"><input placeholder="Courier" value={dispatch.courier} onChange={(e)=>setShipping((s)=>({...s,[order.id]:{...dispatch,courier:e.target.value}}))}/><input placeholder="Tracking" value={dispatch.trackingCode} onChange={(e)=>setShipping((s)=>({...s,[order.id]:{...dispatch,trackingCode:e.target.value}}))}/><button className="primary-button" disabled={busy===order.id} onClick={()=>run(order,()=>adminApi('dispatchOrder',order.tenantId,{orderId:order.id,...dispatch},adminOperationKey('dispatch',order.id)))}><Truck size={16}/> Despachar</button></div>}
          {order.fulfillmentStatus==='DISPATCHED' && <button className="primary-button" disabled={busy===order.id} onClick={()=>run(order,()=>adminApi('markDelivered',order.tenantId,{orderId:order.id},adminOperationKey('delivered',order.id)))}><CheckCircle2 size={16}/> Marcar entregado</button>}
        </div>
      </article>
    })}</section>
  </div>
}
