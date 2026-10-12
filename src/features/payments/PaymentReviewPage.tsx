import { CheckCircle2, Eye, ShieldAlert, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUIStore } from '../../stores/uiStore'
import { date, money, tenantNames } from '../commercial/formatters'
import { EmptyState, StatusPill, TenantFilter } from '../commercial/shared'
import { orderNumber } from '../orders/operational'
import { adminApi, adminApiForScope, adminOperationKey, fetchPaymentProof } from '../admin/adminApi'

type Review = { proof: { id: string; status: string; reference?: string; assetReference?: string; submittedAt: string }; payment: { id: string; amountCents: number; currency: string }; order: { id: string; tenantId: string; customerId: string; customer?: { name?: string; phone?: string }; items?: readonly { productName: string; variantName?: string; size?: string }[] }; customer?: { name?: string; phone?: string } }

export function PaymentReviewPage() {
  const scope = useUIStore((state) => state.tenantScope)
  const [items, setItems] = useState<readonly Review[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [reasons, setReasons] = useState<Record<string,string>>({})
  const [selectedProof, setSelectedProof] = useState<Review | null>(null)
  const [proofUrl, setProofUrl] = useState('')
  const [proofType, setProofType] = useState('')
  const [proofLoading, setProofLoading] = useState(false)
  const [proofError, setProofError] = useState('')
  const load = useCallback(() => {
    setError('')
    void adminApiForScope<Review>('listPaymentReviews', scope).then(setItems).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar la cola de pagos'))
  }, [scope])
  useEffect(() => { queueMicrotask(load) }, [load])
  useEffect(() => () => { if (proofUrl) URL.revokeObjectURL(proofUrl) }, [proofUrl])

  async function openProof(review: Review) {
    setSelectedProof(review); setProofError(''); setProofLoading(true)
    if (proofUrl) URL.revokeObjectURL(proofUrl)
    setProofUrl(''); setProofType('')
    try {
      const blob = await fetchPaymentProof(review.order.tenantId, review.proof.id)
      const url = URL.createObjectURL(blob)
      setProofUrl(url); setProofType(blob.type)
    } catch (cause) { setProofError(cause instanceof Error ? cause.message : 'No se pudo cargar el comprobante.') }
    finally { setProofLoading(false) }
  }

  function closeProof() { setSelectedProof(null); setProofError(''); setProofUrl(''); setProofType('') }

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id); setError('')
    try { await action(); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'La operación no pudo completarse') }
    finally { setBusy('') }
  }

  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Payment verification</span><h1>Revisión de pagos</h1><p>Comprobante recibido ≠ pago confirmado. La aprobación requiere una acción humana autorizada.</p></div><div className="heading-actions"><TenantFilter/></div></div>
    {error && <div className="error-banner">{error}</div>}
    <div className="h3-policy-banner"><ShieldAlert size={19}/><div><strong>Frontera financiera activa</strong><span>Esta pantalla no consulta bancos. El TENANT_OWNER confirma únicamente después de verificar el dinero por un canal externo autorizado.</span></div></div>
    <section className="panel h3-review-list">
      {items.length === 0 ? <EmptyState title="Cola al día" body="No hay comprobantes PENDING o UNDER_REVIEW."/> :
      items.map(({proof,payment,order,customer}) => <article className="h3-review-card" key={proof.id}>
        <div className="h3-review-main"><div><span className="eyebrow">{tenantNames[order.tenantId] ?? order.tenantId}</span><strong>{customer?.name || 'Cliente'}</strong><Link to={`/orders/${order.tenantId}/${order.id}`}><strong>{orderNumber(order)}</strong></Link><small>{customer?.phone ? `**** ${customer.phone.replace(/\D/g,'').slice(-4)} · ` : ''}{proof.reference || 'Sin referencia'} · recibido {date(proof.submittedAt)}</small></div><div className="h3-review-amount"><strong>{money(payment.amountCents,payment.currency)}</strong><StatusPill value={proof.status}/></div></div>
        {order.items?.length ? <p className="muted-copy">{order.items.map(item => [item.productName,item.variantName,item.size].filter(Boolean).join(' · ')).join(', ')}</p> : null}
        <div className="h3-review-actions">
          {proof.assetReference && <button className="secondary-button" disabled={busy===proof.id} onClick={() => void openProof({proof,payment,order,customer})}><Eye size={16}/> Ver comprobante</button>}
          <button className="primary-button" disabled={busy===proof.id} onClick={() => run(proof.id, () => adminApi('approvePayment',order.tenantId,{paymentId:payment.id,proofId:proof.id},adminOperationKey('approve',proof.id)))}><CheckCircle2 size={16}/> Confirmar pago</button>
          <input value={reasons[proof.id] ?? ''} onChange={(e) => setReasons((current) => ({...current,[proof.id]:e.target.value}))} placeholder="Motivo si se rechaza"/>
          <button className="secondary-button danger-button" disabled={busy===proof.id || !(reasons[proof.id] ?? '').trim()} onClick={() => run(proof.id, () => adminApi('rejectPaymentProof',order.tenantId,{paymentId:payment.id,proofId:proof.id,reason:reasons[proof.id]},adminOperationKey('reject',proof.id)))}><XCircle size={16}/> Rechazar</button>
        </div>
      </article>)}
    </section>
    {selectedProof && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeProof() }}><section className="proof-modal" role="dialog" aria-modal="true" aria-labelledby="proof-title"><header><div><span className="eyebrow">{selectedProof.customer?.name || 'Cliente'} · {orderNumber(selectedProof.order as never)}</span><h2 id="proof-title">Comprobante de pago</h2><small>{date(selectedProof.proof.submittedAt)} · {money(selectedProof.payment.amountCents,selectedProof.payment.currency)} · {selectedProof.proof.status}</small></div><button className="icon-button" aria-label="Cerrar comprobante" onClick={closeProof}>×</button></header>{proofLoading?<p role="status">Cargando comprobante…</p>:proofError?<div className="error-banner" role="alert">{proofError}</div>:proofUrl&&proofType==='application/pdf'?<iframe className="proof-frame" src={proofUrl} title="Comprobante de pago"/>:proofUrl&&proofType.startsWith('image/')?<img className="proof-image" src={proofUrl} alt="Comprobante de pago"/>:<p>No se pudo cargar el comprobante.</p>}<footer><button className="primary-button" disabled={busy===selectedProof.proof.id||proofLoading} onClick={() => run(selectedProof.proof.id, async () => { await adminApi('approvePayment',selectedProof.order.tenantId,{paymentId:selectedProof.payment.id,proofId:selectedProof.proof.id},adminOperationKey('approve',selectedProof.proof.id)); closeProof() })}><CheckCircle2 size={16}/> Aprobar</button><button className="secondary-button danger-button" disabled={busy===selectedProof.proof.id||proofLoading} onClick={() => { const reason=window.prompt('Motivo del rechazo'); if(reason?.trim())void run(selectedProof.proof.id,async()=>{await adminApi('rejectPaymentProof',selectedProof.order.tenantId,{paymentId:selectedProof.payment.id,proofId:selectedProof.proof.id,reason},adminOperationKey('reject',selectedProof.proof.id));closeProof()}) }}><XCircle size={16}/> Rechazar</button></footer></section></div>}
  </div>
}
