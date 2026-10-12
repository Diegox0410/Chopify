import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Check, RefreshCw, Send, ShieldCheck, Sparkles } from 'lucide-react'
import './pilot-sandbox.css'

type JsonRecord = Record<string, unknown>
type ChatTurn = { id: string; role: 'customer' | 'assistant'; text: string; image?: { url: string; caption?: string; alt?: string } | null }
type ChatResponse = { sessionId: string; reply: string; messages?: JsonRecord[]; selection: JsonRecord }
type AdminSnapshot = { paymentReviews: JsonRecord[]; orders: JsonRecord[]; customers: JsonRecord[]; products: JsonRecord[] }

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const asArray = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.map(asRecord) : []
const value = (record: JsonRecord, key: string, fallback = '—') => typeof record[key] === 'string' || typeof record[key] === 'number' ? String(record[key]) : fallback
const statusLabel = (record: JsonRecord) => [value(record, 'paymentStatus', 'sin pago'), value(record, 'fulfillmentStatus', 'sin operación')].join(' · ')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const [pathOnly, query = ''] = path.replace(/^\//, '').split('?')
  const action = pathOnly === 'admin/action' ? 'admin-action' : pathOnly === 'reset' ? 'new-session' : pathOnly
  const params = new URLSearchParams(query)
  params.set('action', action)
  const response = await fetch(`/api/pilot-sandbox?${params}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })
  const payload = await response.json().catch(() => ({})) as JsonRecord
  if (!response.ok || payload.ok === false) {
    const checks = asRecord(payload.checks)
    const failures = Object.entries(checks).filter(([, passed]) => passed !== true).map(([key]) => key)
    throw new Error(failures.length ? `Sandbox no listo: ${failures.join(', ')}` : value(payload, 'error', `Sandbox HTTP ${response.status}`))
  }
  return payload as T
}

export function PilotSandboxPage() {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [text, setText] = useState('')
  const [customerName, setCustomerName] = useState('Cliente de prueba')
  const [sessionId, setSessionId] = useState('')
  const [selection, setSelection] = useState<JsonRecord>({})
  const [admin, setAdmin] = useState<AdminSnapshot>({ paymentReviews: [], orders: [], customers: [], products: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [health, setHealth] = useState('Conectando al servidor local…')
  const [seeded, setSeeded] = useState(false)
  const [proofPending, setProofPending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const selectedProduct = value(selection, 'name', 'Sin selección')
  const selectedVariant = [value(selection, 'color', ''), value(selection, 'size', '')].filter(Boolean).join(' · ')
  const orderId = value(selection, 'orderId', '')

  const reloadAdmin = async () => {
    const snapshot = await request<AdminSnapshot>('/admin')
    setAdmin({ paymentReviews: asArray(snapshot.paymentReviews), orders: asArray(snapshot.orders), customers: asArray(snapshot.customers), products: asArray(snapshot.products) })
  }

  useEffect(() => {
    let active = true
    void request<JsonRecord>('/health').then(status => {
      if (active) setHealth(value(status, 'firebaseProjectId', 'Preview sandbox aislado'))
    }).catch(cause => { if (active) setHealth(cause instanceof Error ? cause.message : 'Preview sandbox no disponible.') })
    return () => { active = false }
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns])

  async function sendMessage(message = text, fakeProof = false) {
    const trimmed = message.trim()
    if (!trimmed || busy) return
    setBusy(true); setError(''); setText('')
    const customerTurn: ChatTurn = { id: crypto.randomUUID(), role: 'customer', text: trimmed }
    setTurns(current => [...current, customerTurn])
    try {
      const result = await request<ChatResponse>('/chat', { method: 'POST', body: JSON.stringify({ message: trimmed, sessionId, customerName, fakeProof }) })
      setSessionId(result.sessionId)
      setSelection(asRecord(result.selection))
      setProofPending(false)
      const messages = Array.isArray(result.messages) ? result.messages.map(asRecord) : []
      const assistantTurns: ChatTurn[] = messages.flatMap(message => {
        if (message.type === 'text' && typeof message.text === 'string') return [{ id: crypto.randomUUID(), role: 'assistant', text: message.text }]
        if (message.type === 'image' && typeof message.url === 'string') return [{ id: crypto.randomUUID(), role: 'assistant', text: typeof message.caption === 'string' ? message.caption : 'Imagen del catálogo FLOES.', image: { url: message.url, caption: typeof message.caption === 'string' ? message.caption : undefined, alt: typeof message.alt === 'string' ? message.alt : 'Imagen del producto consultado' } }]
        return []
      })
      if (!assistantTurns.length && result.reply) assistantTurns.push({ id: crypto.randomUUID(), role: 'assistant', text: result.reply })
      setTurns(current => [...current, ...assistantTurns])
      if (asRecord(result.selection).orderId) await reloadAdmin()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar el turno local.')
      setTurns(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text: 'No pude completar ese paso del sandbox. Revisa el error local mostrado y vuelve a intentar.' }])
    } finally { setBusy(false) }
  }

  async function adminAction(operation: string, input: JsonRecord) {
    setBusy(true); setError('')
    try {
      await request('/admin/action', { method: 'POST', body: JSON.stringify({ operation, input }) })
      await reloadAdmin()
      if (operation === 'markDelivered') setTurns(current => [...current, { id: crypto.randomUUID(), role: 'assistant', text: 'El panel FLOES Admin de prueba registró la entrega. Pregúntame por el estado o cuéntame cómo te fue.' }])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción administrativa.') }
    finally { setBusy(false) }
  }

  async function reset() {
    setBusy(true); setError('')
    try {
      await request('/reset', { method: 'POST', body: '{}' })
      setTurns([]); setSelection({}); setSessionId(''); setProofPending(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar una nueva conversación.') }
    finally { setBusy(false) }
  }

  async function prepareFixture() {
    setBusy(true); setError('')
    try {
      await request('/seed', { method: 'POST', body: '{}' })
      setSeeded(true)
      await reloadAdmin()
      setHealth('Fixture escrito en Firestore sandbox aislado')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo preparar el fixture aislado.') }
    finally { setBusy(false) }
  }

  const reviews = useMemo(() => admin.paymentReviews.filter(review => {
    const payment = asRecord(review.payment)
    return ['pending', 'under_review', 'proof_received'].includes(value(payment, 'status', '').toLowerCase())
  }), [admin.paymentReviews])
  const quickStarts = ['Hola, ¿qué modelos tienen?', 'Quiero ver Daniela', '¿Qué talla me recomiendas?']

  return <main className="pilot-page">
    <header className="pilot-topbar">
      <div><span className="pilot-eyebrow">FLOES × CHOPIFY × GANOBOT</span><h1>Sandbox comercial</h1></div>
      <div className="pilot-top-actions"><span className="pilot-status"><ShieldCheck size={15}/>{health}</span><button className="pilot-button pilot-button-light" disabled={busy} onClick={() => void reset()}><RefreshCw size={15}/> Nueva conversación</button></div>
    </header>
    <div className="pilot-warning"><strong>PREVIEW SANDBOX AISLADO</strong><span>GanoBot y Chopify Preview usan un Firebase exclusivo de pruebas. Productos, precios, stock, clientes y pagos que se registren aquí son ficticios. No conecta WhatsApp, Meta ni pasarelas de cobro.</span></div>
    {error && <div className="pilot-error" role="alert">{error}</div>}
    {!seeded && <section className="pilot-seed panel"><div><span className="pilot-eyebrow">Fixture comercial de prueba</span><h2>Daniela · Vino · talla M</h2><p>Se creará únicamente en Firestore sandbox, con precio y stock marcados como sintéticos.</p></div><button className="pilot-button" disabled={busy} onClick={() => void prepareFixture()}><Sparkles size={15}/> Preparar sandbox</button></section>}
    <section className="pilot-grid">
      <div className="pilot-chat panel">
        <div className="pilot-panel-heading"><div><span className="pilot-eyebrow">Conversación simulada</span><h2>Asesor FLOES</h2></div><span className="pilot-channel">Cliente · WhatsApp simulado</span></div>
        <div className="pilot-profile">
          <label>Nombre de prueba<input value={customerName} onChange={event => setCustomerName(event.target.value)} maxLength={100}/></label>
          <span className="pilot-demo-phone">Identidad técnica efímera · no es un número real</span>
        </div>
        <div className="pilot-thread" aria-live="polite">
          {!turns.length && <div className="pilot-empty"><div className="pilot-avatar">F</div><h3>Hola, soy tu asesora FLOES</h3><p>Esta conversación consulta GanoBot Preview y Chopify Preview con registros aislados.</p><div className="pilot-quick-starts">{quickStarts.map(item => <button key={item} disabled={busy || !seeded} onClick={() => void sendMessage(item)}>{item}</button>)}</div></div>}
          {turns.map(turn => <article key={turn.id} className={`pilot-bubble pilot-${turn.role}`}>
            <span>{turn.role === 'customer' ? 'Cliente' : 'GanoBot · motor real'}</span><p>{turn.text}</p>
            {turn.image && <figure><img src={turn.image.url} alt={turn.image.alt ?? 'Imagen de producto para el fixture de prueba'} loading="lazy"/><figcaption>{turn.image.caption ?? 'Imagen asociada al producto de prueba.'}</figcaption></figure>}
          </article>)}
          <div ref={endRef}/>
        </div>
        <div className="pilot-chat-footer">
          <div className="pilot-quick-actions">
            <button disabled={busy || !seeded || !orderId || proofPending} onClick={() => { setProofPending(true); void sendMessage('Envío un comprobante ficticio de transferencia.', true) }}>Adjuntar comprobante ficticio</button>
            {proofPending && <span>Comprobante agregado a revisión</span>}
          </div>
          <form onSubmit={event => { event.preventDefault(); void sendMessage() }}><input aria-label="Mensaje de prueba" value={text} onChange={event => setText(event.target.value)} placeholder="Escribe como cliente…" disabled={busy || !seeded}/><button className="pilot-send" disabled={busy || !seeded || !text.trim()} aria-label="Enviar mensaje"><Send size={17}/></button></form>
          <small><ArrowDown size={12}/> Ejemplo: “Vino”, “Talla M”, “Lo quiero”, “¿Cómo va mi pedido?”</small>
        </div>
      </div>

      <aside className="pilot-side">
        <section className="panel pilot-card">
          <div className="pilot-panel-heading"><div><span className="pilot-eyebrow">Chopify · datos de esta sesión</span><h2>Selección comercial</h2></div><button className="pilot-icon-button" aria-label="Actualizar panel de operación" disabled={busy} onClick={() => void reloadAdmin()}><RefreshCw size={15}/></button></div>
          <dl className="pilot-data-list"><div><dt>Modelo</dt><dd>{selectedProduct}</dd></div><div><dt>Color / talla</dt><dd>{selectedVariant || 'Pendiente de elegir'}</dd></div><div><dt>Cliente ID</dt><dd>{value(selection, 'customerId', 'Se registra al crear borrador')}</dd></div><div><dt>Pedido ID</dt><dd>{orderId || 'Aún no creado'}</dd></div><div><dt>Estado en GanoBot</dt><dd>{value(selection, 'orderStatus', 'Conversando')}</dd></div></dl>
          <p className="pilot-simulated-note">Daniela/Vino, precio USD 39,99, promo USD 34,99 y stock M = fixture sintético. No usar como información de venta.</p>
        </section>

        <section className="panel pilot-card">
          <div className="pilot-panel-heading"><div><span className="pilot-eyebrow">Mismo contrato Owner que usa FLOES Admin</span><h2>Revisión y operación</h2></div></div>
          {reviews.length === 0 ? <p className="pilot-muted">Sin comprobantes pendientes. Adjunta el comprobante ficticio desde la conversación.</p> : reviews.map((review, index) => {
            const order = asRecord(review.order); const proof = asRecord(review.proof); const payment = asRecord(review.payment)
            return <article className="pilot-review" key={value(proof, 'id', String(index))}><strong>Comprobante ficticio · {value(order, 'id')}</strong><span>Cliente {value(order, 'customerId')} · pago {value(payment, 'status')}</span><div><button disabled={busy} onClick={() => void adminAction('approvePayment', { paymentId: value(payment, 'id', ''), proofId: value(proof, 'id', '') })}><Check size={14}/> Simular verificación</button><button className="pilot-decline" disabled={busy} onClick={() => void adminAction('rejectPaymentProof', { paymentId: value(payment, 'id', ''), proofId: value(proof, 'id', '') , reason: 'Rechazo ficticio del sandbox' })}>Declinar prueba</button></div></article>
          })}
          <div className="pilot-order-list">{admin.orders.length === 0 ? <p className="pilot-muted">Todavía no hay pedidos de prueba.</p> : admin.orders.map((order, index) => {
            const id = value(order, 'id', `order-${index}`); const fulfillment = value(order, 'fulfillmentStatus', 'UNFULFILLED'); const payment = value(order, 'paymentStatus', 'UNPAID')
            return <article className="pilot-order" key={id}><div><strong>{id}</strong><span>{statusLabel(order)}</span><small>Pago {payment} · operación {fulfillment}</small></div><div className="pilot-order-actions">
              {payment === 'PAID' && fulfillment === 'UNFULFILLED' && <button disabled={busy} onClick={() => void adminAction('startPreparation', { orderId: id })}>Iniciar preparación</button>}
              {fulfillment === 'PREPARING' && <button disabled={busy} onClick={() => void adminAction('markReady', { orderId: id })}>Marcar listo</button>}
              {fulfillment === 'READY' && <button disabled={busy} onClick={() => void adminAction('dispatchOrder', { orderId: id, courier: 'Transporte ficticio', trackingCode: 'TEST-TRACKING-001' })}>Simular despacho</button>}
              {fulfillment === 'DISPATCHED' && <button disabled={busy} onClick={() => void adminAction('markDelivered', { orderId: id })}>Confirmar entrega</button>}
            </div></article>
          })}</div>
          {orderId && value(selection, 'orderStatus') === 'delivered' && <p className="pilot-muted">Escribe “Ya recibí mi pedido y estoy contenta” para registrar postventa con GanoBot.</p>}
        </section>

        <section className="panel pilot-card pilot-audit"><div className="pilot-panel-heading"><div><span className="pilot-eyebrow">Lecturas de la sesión</span><h2>Registros</h2></div></div><p>Clientes: <strong>{admin.customers.length}</strong> · Productos: <strong>{admin.products.length}</strong> · Pedidos: <strong>{admin.orders.length}</strong></p><p>Origen: handler real de Chopify y endpoint Owner FLOES. Persistencia: Firestore sandbox aislado.</p></section>
      </aside>
    </section>
    <footer className="pilot-footnote">La conversación usa GanoBot Preview y el contrato Commerce Owner de Chopify Preview. Los registros permanecen en el proyecto Firebase sandbox y no representan una venta real.</footer>
  </main>
}
