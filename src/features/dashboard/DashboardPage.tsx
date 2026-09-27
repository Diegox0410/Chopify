import { ArrowRight, Building2, CircleDollarSign, Inbox, MessageSquareWarning, Package, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadDashboard, type DashboardSnapshot } from '../../application/dashboard'
import { SampleEscalationRepository, SampleTenantRepository } from '../../adapters/memory/dashboardRepositories'

const tenants = new SampleTenantRepository()
const escalations = new SampleEscalationRepository()

export function DashboardPage() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  useEffect(() => { void loadDashboard(tenants, escalations).then(setSnapshot) }, [])
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">Visión operativa</span><h1>Buenos días, equipo.</h1><p>Una vista sobria del estado de la plataforma. Los indicadores se activarán al conectar repositorios reales.</p></div><button className="primary-button">Ver negocios <ArrowRight size={16} /></button></div>
    <section className="metric-grid" aria-label="Métricas futuras"><Metric icon={CircleDollarSign} label="Ventas gestionadas" /><Metric icon={Package} label="Pedidos" /><Metric icon={Sparkles} label="Resolución automática" /><Metric icon={MessageSquareWarning} label="Escalaciones humanas" value={snapshot?.attentionCount.toString()} /></section>
    <div className="dashboard-grid"><section className="panel attention-panel"><div className="panel-header"><div><span className="eyebrow">Cola operativa</span><h2>Requiere tu atención</h2></div><span className="count-badge">{snapshot?.attentionCount ?? '—'}</span></div><div className="empty-state"><div className="empty-icon"><Inbox size={22} /></div><strong>Sin excepciones de muestra</strong><p>Las alertas por pago, inventario, entrega o solicitud humana aparecerán aquí.</p></div></section>
      <section className="panel"><div className="panel-header"><div><span className="eyebrow">Portafolio</span><h2>Negocios</h2></div><button className="text-button">Abrir directorio <ArrowRight size={14} /></button></div><div className="business-list">{snapshot?.tenants.map((tenant, index) => <div className="business-row" key={tenant.id}><div className={`business-avatar tone-${index + 1}`}>{tenant.name.slice(0, 2)}</div><div><strong>{tenant.name}</strong><span>Integración no conectada</span></div><span className="status-pill">{tenant.status}</span><button className="row-action" aria-label={`Abrir ${tenant.name}`}><ArrowRight size={16} /></button></div>)}</div></section></div>
    <footer className="data-note"><Building2 size={16} /><span><strong>Modo SAMPLE:</strong> solo nombres de tenants y estados de onboarding. No hay ventas, pedidos ni clientes cargados.</span></footer>
  </div>
}

function Metric({ icon: Icon, label, value }: { icon: typeof CircleDollarSign; label: string; value?: string }) { return <article className="metric"><div className="metric-top"><span className="metric-icon"><Icon size={18} /></span><span className="metric-state">SIN FUENTE</span></div><span className="metric-label">{label}</span><strong>{value ?? '—'}</strong><small>Pendiente de adapter</small></article> }
