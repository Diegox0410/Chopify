import { Bell, Menu, Search } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'
import { navigation } from '../app/navigation'
import { runtimeConfig } from '../config/runtime'
import { useUIStore } from '../stores/uiStore'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const location = useLocation()
  const current = navigation.flatMap((section) => section.items).find((item) => item.path === location.pathname)
  return <div className="app-shell"><Sidebar /><div className="main-column"><header className="topbar"><div className="topbar-title"><button className="icon-button menu-button" onClick={toggleSidebar} aria-label="Abrir navegación"><Menu size={20} /></button><div><span>Command center</span><strong>{current?.label ?? 'Módulo'}</strong></div></div><div className="topbar-actions"><button className="search-button"><Search size={16} /> <span>Buscar en Chopify</span><kbd>⌘ K</kbd></button><button className="icon-button" aria-label="Notificaciones"><Bell size={18} /></button><div className="profile"><span>PO</span><div><strong>Platform Owner</strong><small>Super Admin</small></div></div></div></header><div className="environment-strip"><span>SAMPLE</span>{runtimeConfig.environmentLabel} · Ningún dato representa operación real</div><main className="content"><Outlet /></main></div></div>
}
