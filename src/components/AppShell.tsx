import { Bell, Menu, Search } from 'lucide-react'
import { signOut } from 'firebase/auth'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { navigation } from '../app/navigation'
import { auth } from '../auth/firebaseClient'
import { useUIStore } from '../stores/uiStore'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const location = useLocation()
  const navigate = useNavigate()
  const current = navigation.flatMap((section) => section.items).find((item) => item.path === location.pathname || (item.path !== '/' && location.pathname.startsWith(`${item.path}/`)))
  const logout=async()=>{await signOut(auth);navigate('/login',{replace:true})}
  return <div className="app-shell"><Sidebar /><div className="main-column"><header className="topbar"><div className="topbar-title"><button className="icon-button menu-button" onClick={toggleSidebar} aria-label="Abrir navegación"><Menu size={20} /></button><div><span>Command center</span><strong>{current?.label ?? 'Módulo'}</strong></div></div><div className="topbar-actions"><button className="search-button"><Search size={16} /> <span>Buscar en Chopify</span><kbd>⌘ K</kbd></button><button className="icon-button" aria-label="Notificaciones"><Bell size={18} /></button><button type="button" className="profile" onClick={()=>void logout()} title="Cerrar sesión"><span>PO</span><div><strong>Platform Owner</strong><small>Cerrar sesión</small></div></button></div></header><div className="environment-strip"><span>LIVE</span>Producción · multi-tenant · Sin datos reales se muestra un estado vacío</div><main className="content"><Outlet /></main></div></div>
}
