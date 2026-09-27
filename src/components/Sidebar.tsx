import { X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { navigation } from '../app/navigation'
import { useUIStore } from '../stores/uiStore'

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useUIStore()
  return <>
    <button className={`sidebar-backdrop ${sidebarOpen ? 'is-open' : ''}`} onClick={() => setSidebarOpen(false)} aria-label="Cerrar navegación" />
    <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="brand"><div className="brand-mark">C</div><div><strong>CHOPIFY</strong><span>Commercial OS</span></div><button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Cerrar navegación"><X size={18} /></button></div>
      <nav>{navigation.map((section) => <div className="nav-section" key={section.label}><div className="nav-heading">{section.label}</div>{section.items.map(({ label, path, icon: Icon, note }) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{note && <i>{note}</i>}</NavLink>)}</div>)}</nav>
      <div className="sidebar-foot"><span className="status-dot" /> <span>Foundation environment</span><small>v0.1.0</small></div>
    </aside>
  </>
}
