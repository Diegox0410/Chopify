import type { OpportunityStatus } from '../../domain'
import { useUIStore } from '../../stores/uiStore'

export const money = (cents: number, currency = 'COP') => new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
export const date = (value?: string) => value ? new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—'
export const statusLabel = (status: string) => status.replaceAll('_', ' ')
export const tenantNames: Record<string, string> = { 'tenant-mg': 'MG', 'tenant-dgng': 'DGNG', 'tenant-floes': 'FLOES' }
export const operationalStatuses: readonly OpportunityStatus[] = ['OPEN', 'QUALIFIED', 'CART_STARTED', 'ORDER_CREATED']

export function TenantFilter() {
  const scope = useUIStore((state) => state.tenantScope)
  const setScope = useUIStore((state) => state.setTenantScope)
  return <label className="field compact-field"><span>Negocio</span><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="ALL">Todos los negocios</option><option value="tenant-mg">MG</option><option value="tenant-dgng">DGNG</option><option value="tenant-floes">FLOES</option></select></label>
}

export function StatusPill({ value }: { value: string }) { return <span className={`entity-status status-${value.toLowerCase()}`}>{statusLabel(value)}</span> }
export function SampleBadge() { return <span className="sample-badge">SAMPLE MODE</span> }
export function EmptyState({ title, body }: { title: string; body: string }) { return <div className="commercial-empty"><strong>{title}</strong><p>{body}</p></div> }
