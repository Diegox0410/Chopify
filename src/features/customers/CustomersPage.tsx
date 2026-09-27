import { ArrowRight, Plus, Search, Users } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { sampleCommercialApp } from '../../application/sampleApp'
import type { Customer, CustomerStatus, Opportunity } from '../../domain'
import { OPEN_PIPELINE_STATUSES } from '../../domain'
import { useUIStore } from '../../stores/uiStore'
import { date, money, tenantNames } from '../commercial/formatters'
import { EmptyState, SampleBadge, StatusPill, TenantFilter } from '../commercial/shared'

export function CustomersPage() {
  const scope = useUIStore((state) => state.tenantScope)
  const [customers, setCustomers] = useState<readonly Customer[]>([])
  const [opportunities, setOpportunities] = useState<readonly Opportunity[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CustomerStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const load = useCallback(() => { setLoading(true); setError(''); void Promise.all([sampleCommercialApp.listCustomers(scope, { search, status: status || undefined }), sampleCommercialApp.listOpportunities(scope)]).then(([nextCustomers, nextOpportunities]) => { setCustomers(nextCustomers); setOpportunities(nextOpportunities) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No fue posible cargar clientes')).finally(() => setLoading(false)) }, [scope, search, status])
  useEffect(() => {
  queueMicrotask(load)
}, [load])
  const summary = useMemo(() => new Map(customers.map((customer) => { const open = opportunities.filter((item) => item.customerId === customer.id && item.tenantId === customer.tenantId && OPEN_PIPELINE_STATUSES.includes(item.status)); return [customer.id, { count: open.length, value: open.reduce((sum, item) => sum + item.estimatedValueCents, 0) }] })), [customers, opportunities])
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const tenantId = String(data.get('tenantId')); try { await sampleCommercialApp.createCustomer({ tenantId, name: String(data.get('name')), phone: String(data.get('phone')) || undefined, email: String(data.get('email')) || undefined, acquisitionSource: String(data.get('source')) || undefined }); setCreating(false); event.currentTarget.reset(); load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible crear el cliente') } }
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">CRM operativo</span><h1>Clientes</h1><p>Identidades comerciales separadas por negocio, con pipeline y actividad contextual.</p></div><div className="heading-actions"><SampleBadge /><button className="primary-button" onClick={() => setCreating((value) => !value)}><Plus size={16} /> Crear cliente</button></div></div>
    <div className="filter-bar"><label className="search-field"><Search size={16} /><span className="sr-only">Buscar clientes</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, email o teléfono" /></label><TenantFilter /><label className="field compact-field"><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value as CustomerStatus | '')}><option value="">Todos</option><option>LEAD</option><option>ACTIVE</option><option>INACTIVE</option><option>ARCHIVED</option></select></label></div>
    {creating && <form className="inline-form panel" onSubmit={create}><div><span className="eyebrow">Nuevo registro SAMPLE</span><h2>Crear cliente</h2></div><label className="field"><span>Negocio</span><select name="tenantId" defaultValue={scope === 'ALL' ? 'tenant-mg' : scope}><option value="tenant-mg">MG</option><option value="tenant-dgng">DGNG</option><option value="tenant-floes">FLOES</option></select></label><label className="field"><span>Nombre</span><input name="name" required /></label><label className="field"><span>Teléfono</span><input name="phone" /></label><label className="field"><span>Email</span><input name="email" type="email" /></label><label className="field"><span>Origen</span><input name="source" /></label><button className="primary-button" type="submit">Guardar cliente</button></form>}
    {error && <div className="error-banner" role="alert">{error} <button onClick={load}>Reintentar</button></div>}
    <section className="panel data-panel"><div className="table-header"><span>{loading ? 'Cargando…' : `${customers.length} clientes`}</span><small>Datos ficticios aislados</small></div>{!loading && customers.length === 0 ? <EmptyState title="Sin clientes en este filtro" body="Ajusta la búsqueda o crea el primer cliente SAMPLE." /> : <div className="responsive-table"><div className="table-row table-labels"><span>Customer</span><span>Business</span><span>Status</span><span>Origin</span><span>Last interaction</span><span>Open opportunities</span><span>Open pipeline</span><span /></div>{customers.map((customer) => <div className="table-row" key={`${customer.tenantId}-${customer.id}`}><div className="entity-primary"><span className="initial-avatar"><Users size={15} /></span><div><strong>{customer.name}</strong><small>{customer.email || customer.phone || 'Sin contacto'}</small></div></div><span data-label="Business">{tenantNames[customer.tenantId]}</span><span data-label="Status"><StatusPill value={customer.status} /></span><span data-label="Origin">{customer.acquisitionSource || '—'}</span><span data-label="Last interaction">{date(customer.lastInteractionAt)}</span><span data-label="Open opportunities">{summary.get(customer.id)?.count ?? 0}</span><strong data-label="Open pipeline">{money(summary.get(customer.id)?.value ?? 0)}</strong><Link className="row-link" aria-label={`Abrir ${customer.name}`} to={`/customers/${customer.tenantId}/${customer.id}`}><ArrowRight size={16} /></Link></div>)}</div>}</section>
  </div>
}
