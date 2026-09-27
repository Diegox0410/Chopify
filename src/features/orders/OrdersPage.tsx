import { ArrowRight, PackageCheck, ReceiptText, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sampleOrderApp } from '../../application/sampleApp'
import type { Order } from '../../domain'
import { useUIStore } from '../../stores/uiStore'
import { date, money, tenantNames } from '../commercial/formatters'
import { EmptyState, SampleBadge, StatusPill, TenantFilter } from '../commercial/shared'
import { orderNumber } from './operational'

export function OrdersPage() {
  const scope = useUIStore((state) => state.tenantScope)
  const [items, setItems] = useState<readonly Order[]>([])
  const [query, setQuery] = useState('')
  const [payment, setPayment] = useState('')
  const [fulfillment, setFulfillment] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setError('')
    void sampleOrderApp.listOrders(scope).then(setItems).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar pedidos'))
  }, [scope])
  useEffect(() => { queueMicrotask(load) }, [load])

  const filtered = useMemo(() => items.filter((item) => {
    const text = `${item.id} ${item.customerId} ${item.items.map((line) => line.productName).join(' ')}`.toLowerCase()
    return (!query || text.includes(query.toLowerCase())) &&
      (!payment || item.paymentStatus === payment) &&
      (!fulfillment || item.fulfillmentStatus === fulfillment)
  }), [items, query, payment, fulfillment])

  const total = filtered.reduce((sum, item) => sum + item.grandTotalCents, 0)

  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Order operations</span><h1>Pedidos</h1><p>Estado comercial, pago, reserva y fulfillment sin mezclar responsabilidades.</p></div><div className="heading-actions"><SampleBadge /><TenantFilter /></div></div>
    {error && <div className="error-banner">{error} <button onClick={load}>Reintentar</button></div>}
    <section className="h3-summary-grid">
      <article><ReceiptText size={18}/><span>Pedidos visibles</span><strong>{filtered.length}</strong></article>
      <article><PackageCheck size={18}/><span>Valor visible</span><strong>{money(total, filtered[0]?.currency ?? 'COP')}</strong></article>
      <article><span className="h3-dot warning"/><span>Por verificar</span><strong>{filtered.filter((x) => ['PROOF_RECEIVED','UNDER_REVIEW'].includes(x.paymentStatus)).length}</strong></article>
      <article><span className="h3-dot success"/><span>Pagados activos</span><strong>{filtered.filter((x) => x.paymentStatus === 'PAID' && x.fulfillmentStatus !== 'DELIVERED').length}</strong></article>
    </section>
    <section className="panel h3-filter-panel">
      <label className="h3-search"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pedido, cliente o producto"/></label>
      <select value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Filtrar pago"><option value="">Todos los pagos</option><option>UNPAID</option><option>PROOF_RECEIVED</option><option>UNDER_REVIEW</option><option>PAID</option><option>REJECTED</option><option>REFUNDED</option></select>
      <select value={fulfillment} onChange={(e) => setFulfillment(e.target.value)} aria-label="Filtrar fulfillment"><option value="">Todo fulfillment</option><option>UNFULFILLED</option><option>PREPARING</option><option>READY</option><option>DISPATCHED</option><option>DELIVERED</option><option>CANCELLED</option></select>
    </section>
    <section className="panel h3-table-panel">
      {filtered.length === 0 ? <EmptyState title="Sin pedidos" body="No hay pedidos que coincidan con los filtros actuales."/> :
      <div className="h3-table-wrap"><table className="h3-table"><thead><tr><th>Pedido</th><th>Negocio</th><th>Pago</th><th>Fulfillment</th><th>Total</th><th>Actualizado</th><th/></tr></thead><tbody>{filtered.map((item) =>
        <tr key={`${item.tenantId}-${item.id}`}><td><strong>{orderNumber(item)}</strong><small>{item.customerId}</small></td><td>{tenantNames[item.tenantId] ?? item.tenantId}</td><td><StatusPill value={item.paymentStatus}/></td><td><StatusPill value={item.fulfillmentStatus}/></td><td><strong>{money(item.grandTotalCents,item.currency)}</strong></td><td>{date(item.updatedAt)}</td><td><Link className="icon-button" aria-label={`Abrir ${item.id}`} to={`/orders/${item.tenantId}/${item.id}`}><ArrowRight size={16}/></Link></td></tr>)}</tbody></table></div>}
    </section>
  </div>
}
