import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminCall } from '../../services/adminApi'
import { useUIStore } from '../../stores/uiStore'
import { tenantDefinitions, tenantIds } from '../../config/tenantRegistry.js'
import { conversationDate, type LiveCustomer } from '../conversations/conversationApi'

export function CustomersPage() {
  const tenant = useUIStore(state => state.tenantScope)
  const setTenant = useUIStore(state => state.setTenantScope)
  const [customers, setCustomers] = useState<Array<LiveCustomer & {lastInteractionAt?:string}>>([])
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(''); const [page, setPage] = useState(0)
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      const ids = tenant === 'all' || tenant === 'ALL' ? tenantIds : [tenant]
      void Promise.all(ids.map(id => adminCall<Array<LiveCustomer & {lastInteractionAt?:string}>>('listCustomers', id)))
        .then(rows => { if (!cancelled) { setCustomers(rows.flat()); setPage(0) } })
        .catch(cause => { if (!cancelled) { setCustomers([]); setError(cause instanceof Error ? cause.message : 'Datos no disponibles') } })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [tenant])
  const needle = query.trim().toLocaleLowerCase('es')
  const filtered = customers.filter(customer => `${customer.name} ${customer.email || ''} ${customer.phone || ''}`.toLocaleLowerCase('es').includes(needle))
  const visible = filtered.slice(page * 25, (page + 1) * 25)
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">CRM persistido</span><h1>Clientes</h1><p>La ficha recupera las conversaciones desde la misma fuente de mensajes.</p></div><label>Negocio <select value={tenant} onChange={event => setTenant(event.target.value)}><option value="all">Todos los negocios</option>{tenantIds.map(id => <option key={id} value={id}>{tenantDefinitions[id].name}</option>)}</select></label></div><label>Buscar cliente <input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>{error && <div className="error-banner" role="alert">{error}</div>}<section className="panel admin-record-list">{loading ? <p>Cargando clientes…</p> : !visible.length ? <p>Sin clientes persistidos en este filtro.</p> : visible.map(customer => <article key={`${customer.tenantId}:${customer.id}`}><header><Link to={`/customers/${customer.tenantId}/${customer.id}`}>{customer.name}</Link><span>{customer.status}</span></header><p>{tenantDefinitions[customer.tenantId]?.name || customer.tenantId} · {customer.phone || customer.email || 'Sin contacto'}</p><small>Última interacción: {conversationDate(customer.lastInteractionAt)}</small></article>)}</section><div className="heading-actions"><button className="secondary-button" disabled={!page} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1}</span><button className="secondary-button" disabled={(page + 1) * 25 >= filtered.length} onClick={() => setPage(page + 1)}>Siguiente</button></div></div>
}
