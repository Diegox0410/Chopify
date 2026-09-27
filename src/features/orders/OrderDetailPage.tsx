import { ArrowLeft, CheckCircle2, Clock3, Package, ReceiptText, ShieldCheck, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { sampleOrderApp } from '../../application/sampleApp'
import type { OrderDetail } from '../../application/orders'
import { date, money, tenantNames } from '../commercial/formatters'
import { SampleBadge, StatusPill } from '../commercial/shared'
import { operationKey, orderNumber, ownerActor } from './operational'

export function OrderDetailPage() {
  const { tenantId = '', orderId = '' } = useParams()
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reference, setReference] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const load = useCallback(() => {
    setError('')
    void sampleOrderApp.getOrderDetail(tenantId, orderId).then(setDetail).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar el pedido'))
  }, [tenantId, orderId])
  useEffect(() => { queueMicrotask(load) }, [load])

  async function submitProof() {
    setBusy(true); setError('')
    try {
      await sampleOrderApp.submitPaymentProof({ tenantId, orderId, reference: reference || undefined, idempotencyKey: operationKey('proof', orderId), actor: ownerActor(tenantId) })
      setReference(''); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible registrar el comprobante') } finally { setBusy(false) }
  }
  async function cancel() {
    if (!cancelReason.trim()) { setError('Escribe el motivo de cancelación.'); return }
    setBusy(true); setError('')
    try {
      await sampleOrderApp.cancelOrder({ tenantId, orderId, reason: cancelReason, idempotencyKey: operationKey('cancel', orderId), actor: ownerActor(tenantId) })
      setCancelReason(''); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible cancelar el pedido') } finally { setBusy(false) }
  }

  if (!detail && !error) return <div className="page"><p className="muted-copy">Cargando pedido…</p></div>
  if (!detail) return <div className="page"><div className="error-banner">{error}</div><Link className="text-link" to="/orders">Volver a pedidos</Link></div>
  const { order, payment, proofs, reservation, activities } = detail
  const canSubmitProof = ['UNPAID','REJECTED'].includes(payment.status)
  const canCancel = order.orderStatus !== 'CANCELLED' && order.orderStatus !== 'COMPLETED' && order.paymentStatus !== 'PAID'

  return <div className="page">
    <div className="page-heading"><div><Link className="text-link" to="/orders"><ArrowLeft size={14}/> Pedidos</Link><span className="eyebrow">Order detail · {tenantNames[tenantId] ?? tenantId}</span><h1>{orderNumber(order)}</h1><p>Snapshot histórico y operación autoritativa del pedido.</p></div><div className="heading-actions"><SampleBadge/><StatusPill value={order.orderStatus}/></div></div>
    {error && <div className="error-banner">{error}</div>}
    <section className="h3-summary-grid">
      <article><ReceiptText size={18}/><span>Total</span><strong>{money(order.grandTotalCents,order.currency)}</strong></article>
      <article><ShieldCheck size={18}/><span>Pago</span><strong>{payment.status.replaceAll('_',' ')}</strong></article>
      <article><Package size={18}/><span>Fulfillment</span><strong>{order.fulfillmentStatus.replaceAll('_',' ')}</strong></article>
      <article><Clock3 size={18}/><span>Reserva</span><strong>{reservation?.status ?? 'NO APLICA'}</strong></article>
    </section>
    <div className="h3-two-col">
      <section className="panel detail-panel"><div className="section-heading"><div><span className="eyebrow">Snapshot</span><h2>Productos y totales</h2></div></div>
        <div className="h3-lines">{order.items.map((line) => <div key={`${line.productId}-${line.variantId ?? ''}`}><div><strong>{line.productName}</strong><small>{line.variantName ?? line.productId} · {line.quantity} × {money(line.unitPriceCents,order.currency)}</small></div><b>{money(line.lineTotalCents,order.currency)}</b></div>)}</div>
        <div className="h3-totals"><span>Subtotal <b>{money(order.productSubtotalCents,order.currency)}</b></span><span>Descuento <b>-{money(order.discountTotalCents,order.currency)}</b></span><span>Envío <b>{money(order.shippingTotalCents,order.currency)}</b></span><span>Impuestos <b>{money(order.taxTotalCents,order.currency)}</b></span><span className="total">Total <b>{money(order.grandTotalCents,order.currency)}</b></span></div>
      </section>
      <section className="panel detail-panel"><div className="section-heading"><div><span className="eyebrow">Attribution</span><h2>Economía administrada</h2></div></div>
        <div className="overview-grid"><Info label="Managed" value={order.managedSnapshot.managed ? 'Sí' : 'No'}/><Info label="Managed by" value={order.managedSnapshot.managedBy}/><Info label="Origen" value={order.attributionSnapshot.acquisitionSource ?? '—'}/><Info label="Conversión" value={order.attributionSnapshot.conversionChannel ?? '—'}/><Info label="Base administrada" value={money(order.managedSnapshot.managedRevenueBaseCents,order.currency)}/><Info label="Fee" value={money(order.managedSnapshot.managementFeeCents,order.currency)}/><Info label="Tasa snapshot" value={`${order.managedSnapshot.managedOrderRateBps / 100}%`}/><Info label="Reglas" value={order.commercialAgreementSnapshot?.rulesVersion ?? '—'}/></div>
      </section>
    </div>
    <div className="h3-two-col">
      <section className="panel detail-panel"><div className="section-heading"><div><span className="eyebrow">Payment evidence</span><h2>Comprobantes</h2></div><StatusPill value={payment.status}/></div>
        <div className="stack-list">{proofs.length ? proofs.map((proof) => <article className="h3-proof" key={proof.id}><div><strong>{proof.reference || proof.id}</strong><small>{proof.type} · {date(proof.submittedAt)}</small></div><StatusPill value={proof.status}/>{proof.rejectionReason && <small className="h3-rejection">{proof.rejectionReason}</small>}</article>) : <p className="muted-copy">Aún no hay comprobantes.</p>}</div>
        {canSubmitProof && <div className="h3-action-box"><strong>Registrar comprobante SAMPLE</strong><p>Registrar evidencia no confirma que el dinero haya llegado.</p><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referencia de transferencia"/><button className="primary-button" disabled={busy} onClick={submitProof}>Registrar comprobante</button></div>}
        {['PROOF_RECEIVED','UNDER_REVIEW'].includes(payment.status) && <Link className="text-link" to="/payments/review">Abrir cola de verificación →</Link>}
      </section>
      <section className="panel detail-panel"><div className="section-heading"><div><span className="eyebrow">Control</span><h2>Reserva y pedido</h2></div></div>
        <div className="overview-grid"><Info label="Reserva" value={reservation?.status ?? 'No aplica'}/><Info label="Expira" value={date(reservation?.expiresAt)}/><Info label="Creado" value={date(order.createdAt)}/><Info label="Confirmado" value={date(order.confirmedAt)}/></div>
        {canCancel && <div className="h3-action-box danger"><strong><XCircle size={16}/> Cancelar pedido</strong><p>Solo libera inventario cuando la reserva sigue ACTIVE.</p><input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Motivo obligatorio"/><button className="secondary-button" disabled={busy} onClick={cancel}>Cancelar pedido</button></div>}
        {order.paymentStatus === 'PAID' && <div className="h3-callout success"><CheckCircle2 size={17}/><div><strong>Pago confirmado</strong><span>La operación logística puede continuar desde Fulfillment.</span></div></div>}
      </section>
    </div>
    <section className="panel detail-panel"><div className="section-heading"><div><span className="eyebrow">Audit trail</span><h2>Actividad del pedido</h2></div></div><div className="stack-list">{activities.length ? activities.map((activity) => <article className="timeline-item" key={activity.id}><span/><div><strong>{activity.summary || activity.type}</strong><small>{activity.actorType} · {date(activity.occurredAt)}</small></div></article>) : <p className="muted-copy">Sin actividad registrada.</p>}</div></section>
  </div>
}
function Info({label,value}:{label:string;value:string}) { return <div className="info-block"><span>{label}</span><strong>{value}</strong></div> }
