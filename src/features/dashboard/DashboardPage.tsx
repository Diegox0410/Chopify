import { AlertTriangle, ArrowRight, Building2, CircleDollarSign, Sparkles, Target } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { sampleCommercialApp } from '../../application/sampleApp'
import { useUIStore } from '../../stores/uiStore'
import { money, statusLabel } from '../commercial/formatters'
import { SampleBadge, TenantFilter } from '../commercial/shared'

type Snapshot = Awaited<ReturnType<typeof sampleCommercialApp.loadDashboard>>
export function DashboardPage() {
  const scope = useUIStore((state) => state.tenantScope)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => { setSnapshot(null); setError(''); void sampleCommercialApp.loadDashboard(scope).then(setSnapshot).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No fue posible cargar el dashboard')) }, [scope])
 useEffect(() => {
  queueMicrotask(load)
}, [load])
  if (error) return <div className="page"><div className="error-banner">{error} <button onClick={load}>Reintentar</button></div></div>
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">Commercial command center</span><h1>Operación comercial, sin ruido.</h1><p>Pipeline, atención y negocios derivados de repositorios SAMPLE tenant-aware.</p></div><div className="heading-actions"><SampleBadge /><TenantFilter /></div></div>
    <section className="metric-grid" aria-label="Métricas comerciales"><Metric icon={Target} label="Oportunidades abiertas" value={snapshot?.conversions.open.toString()} note="Etapas operativas" /><Metric icon={CircleDollarSign} label="Pipeline estimado" value={snapshot ? money(snapshot.pipeline.totalOpenPipelineValue) : undefined} note="No es revenue real" /><Metric icon={Sparkles} label="Oportunidades ganadas" value={snapshot?.pipeline.wonCount.toString()} note="Resultado SAMPLE" /><Metric icon={AlertTriangle} label="Requiere atención" value={snapshot?.attention.length.toString()} note="Conversaciones y tareas" /></section>
    <div className="dashboard-grid"><section className="panel"><div className="panel-header"><div><span className="eyebrow">Pipeline overview</span><h2>Etapas operativas</h2></div><Link className="text-link" to="/opportunities">Abrir pipeline <ArrowRight size={14} /></Link></div><div className="stage-summary">{(['OPEN','QUALIFIED','CART_STARTED','ORDER_CREATED'] as const).map((status) => <div key={status}><span>{statusLabel(status)}</span><strong>{snapshot?.pipeline.countByStatus[status] ?? '—'}</strong><small>{snapshot ? money(snapshot.pipeline.estimatedValueByStatus[status]) : 'Cargando'}</small></div>)}</div></section>
      <section className="panel"><div className="panel-header"><div><span className="eyebrow">Requires attention</span><h2>Cola priorizada</h2></div><span className="count-badge">{snapshot?.attention.length ?? '—'}</span></div><div className="attention-list">{snapshot?.attention.length === 0 && <p className="muted-copy">Sin elementos pendientes.</p>}{snapshot?.attention.slice(0, 5).map((item) => <div className="attention-row" key={`${item.sourceType}-${item.sourceId}`}><span className={`priority-dot priority-${item.priority.toLowerCase()}`} /><div><strong>{item.label}</strong><small>{item.sourceType.replaceAll('_', ' ')} · {item.priority}</small></div><span>{item.tenantId.replace('tenant-', '').toUpperCase()}</span></div>)}</div></section></div>
    <section className="panel businesses-panel"><div className="panel-header"><div><span className="eyebrow">Businesses</span><h2>Portafolio visible</h2></div></div><div className="business-cards">{snapshot?.tenants.map((tenant) => <article key={tenant.id}><div className="business-avatar">{tenant.name.slice(0, 2)}</div><div><strong>{tenant.name}</strong><span>{tenant.status} · repositorio SAMPLE</span></div><Building2 size={17} /></article>)}</div></section>
  </div>
}
function Metric({ icon: Icon, label, value, note }: { icon: typeof Target; label: string; value?: string; note: string }) { return <article className="metric"><div className="metric-top"><span className="metric-icon"><Icon size={18} /></span><span className="metric-state">SAMPLE</span></div><span className="metric-label">{label}</span><strong>{value ?? '—'}</strong><small>{note}</small></article> }
