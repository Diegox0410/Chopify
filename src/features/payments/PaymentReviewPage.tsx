import { CheckCircle2, Eye, ShieldAlert, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { sampleOrderApp } from '../../application/sampleApp'
import { useUIStore } from '../../stores/uiStore'
import { date, money, tenantNames } from '../commercial/formatters'
import { EmptyState, SampleBadge, StatusPill, TenantFilter } from '../commercial/shared'
import { operationKey, orderNumber, ownerActor } from '../orders/operational'

type Review = Awaited<ReturnType<typeof sampleOrderApp.paymentReviews>>[number]

export function PaymentReviewPage() {
  const scope = useUIStore((state) => state.tenantScope)
  const [items, setItems] = useState<readonly Review[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [reasons, setReasons] = useState<Record<string,string>>({})
  const load = useCallback(() => {
    setError('')
    void sampleOrderApp.paymentReviews(scope).then(setItems).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar la cola de pagos'))
  }, [scope])
  useEffect(() => { queueMicrotask(load) }, [load])

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id); setError('')
    try { await action(); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'La operación no pudo completarse') }
    finally { setBusy('') }
  }

  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Payment verification</span><h1>Revisión de pagos</h1><p>Comprobante recibido ≠ pago confirmado. La aprobación requiere una acción humana autorizada.</p></div><div className="heading-actions"><SampleBadge/><TenantFilter/></div></div>
    {error && <div className="error-banner">{error}</div>}
    <div className="h3-policy-banner"><ShieldAlert size={19}/><div><strong>Frontera financiera activa</strong><span>Esta pantalla no consulta bancos. El TENANT_OWNER confirma únicamente después de verificar el dinero por un canal externo autorizado.</span></div></div>
    <section className="panel h3-review-list">
      {items.length === 0 ? <EmptyState title="Cola al día" body="No hay comprobantes RECEIVED o UNDER_REVIEW."/> :
      items.map(({proof,payment,order}) => <article className="h3-review-card" key={proof.id}>
        <div className="h3-review-main"><div><span className="eyebrow">{tenantNames[order.tenantId] ?? order.tenantId}</span><Link to={`/orders/${order.tenantId}/${order.id}`}><strong>{orderNumber(order)}</strong></Link><small>{proof.reference || proof.id} · enviado {date(proof.submittedAt)}</small></div><div className="h3-review-amount"><strong>{money(payment.amountCents,payment.currency)}</strong><StatusPill value={proof.status}/></div></div>
        <div className="h3-review-actions">
          {proof.status === 'RECEIVED' && <button className="secondary-button" disabled={busy===proof.id} onClick={() => run(proof.id, () => sampleOrderApp.startPaymentReview({tenantId:order.tenantId,paymentId:payment.id,proofId:proof.id,actor:ownerActor(order.tenantId)}))}><Eye size={16}/> Iniciar revisión</button>}
          <button className="primary-button" disabled={busy===proof.id} onClick={() => run(proof.id, () => sampleOrderApp.approvePayment({tenantId:order.tenantId,paymentId:payment.id,proofId:proof.id,idempotencyKey:operationKey('approve',proof.id),actor:ownerActor(order.tenantId)}))}><CheckCircle2 size={16}/> Confirmar pago</button>
          <input value={reasons[proof.id] ?? ''} onChange={(e) => setReasons((current) => ({...current,[proof.id]:e.target.value}))} placeholder="Motivo si se rechaza"/>
          <button className="secondary-button danger-button" disabled={busy===proof.id || !(reasons[proof.id] ?? '').trim()} onClick={() => run(proof.id, () => sampleOrderApp.rejectPaymentProof({tenantId:order.tenantId,paymentId:payment.id,proofId:proof.id,reason:reasons[proof.id],idempotencyKey:operationKey('reject',proof.id),actor:ownerActor(order.tenantId)}))}><XCircle size={16}/> Rechazar</button>
        </div>
      </article>)}
    </section>
  </div>
}
