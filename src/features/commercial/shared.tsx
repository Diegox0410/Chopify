import { useUIStore } from '../../stores/uiStore'
import { statusLabel } from './formatters'

export function TenantFilter() {
  const scope = useUIStore((state) => state.tenantScope)
  const setScope = useUIStore((state) => state.setTenantScope)

  return (
    <label className="field compact-field">
      <span>Negocio</span>
      <select
        value={scope}
        onChange={(event) => setScope(event.target.value)}
      >
        <option value="ALL">Todos los negocios</option>
        <option value="tenant-floes">FLOES</option>
        <option value="tenant-mg">MG Salud y Belleza</option>
        <option value="tenant-dgng">DGNG</option>
      </select>
    </label>
  )
}

export function StatusPill({ value }: { value: string }) {
  return (
    <span className={`entity-status status-${value.toLowerCase()}`}>
      {statusLabel(value)}
    </span>
  )
}

export function SampleBadge() {
  return <span className="sample-badge">DATOS REALES</span>
}

export function EmptyState({
  title,
  body,
}: {
  title: string
  body: string
}) {
  return (
    <div className="commercial-empty">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}
