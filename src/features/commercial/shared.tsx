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
        <option value="tenant-mg">MG</option>
        <option value="tenant-dgng">DGNG</option>
        <option value="tenant-floes">FLOES</option>
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
  return <span className="sample-badge">SAMPLE MODE</span>
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