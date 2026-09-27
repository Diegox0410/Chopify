import type { LucideIcon } from 'lucide-react'
import { Activity, BarChart3, Bot, Boxes, Building2, CalendarDays, CircleDollarSign, Contact, CreditCard, FileStack, Gauge, HandCoins, Headphones, LayoutDashboard, Megaphone, MessageSquareText, PackageCheck, ReceiptText, RefreshCw, Settings, ShieldAlert, ShoppingBag, SlidersHorizontal, Sparkles, UsersRound, Workflow } from 'lucide-react'

export interface NavItem { label: string; path: string; icon: LucideIcon; note?: string }
export interface NavSection { label: string; items: readonly NavItem[] }
export const navigation: readonly NavSection[] = [
  { label: 'Resumen', items: [{ label: 'Dashboard', path: '/', icon: LayoutDashboard }] },
  { label: 'Operación', items: [{ label: 'Negocios', path: '/businesses', icon: Building2 }, { label: 'Clientes', path: '/customers', icon: Contact }, { label: 'Conversaciones', path: '/conversations', icon: MessageSquareText }, { label: 'Oportunidades', path: '/opportunities', icon: Sparkles }, { label: 'Pedidos', path: '/orders', icon: ShoppingBag }, { label: 'Excepciones', path: '/exceptions', icon: ShieldAlert }] },
  { label: 'Automatización', items: [{ label: 'GanoBot', path: '/ganobot', icon: Bot, note: 'Próximamente' }, { label: 'Automatizaciones', path: '/automations', icon: Workflow }, { label: 'Seguimientos', path: '/follow-ups', icon: Activity }, { label: 'Postventa', path: '/post-sale', icon: Headphones }, { label: 'Recompra', path: '/repurchase', icon: RefreshCw }] },
  { label: 'Contenido', items: [{ label: 'Calendario', path: '/calendar', icon: CalendarDays }, { label: 'Publicaciones', path: '/publications', icon: FileStack }, { label: 'Campañas', path: '/campaigns', icon: Megaphone }] },
  { label: 'Finanzas Chopify', items: [{ label: 'Ventas gestionadas', path: '/managed-sales', icon: HandCoins }, { label: 'Comisiones', path: '/fees', icon: CircleDollarSign }, { label: 'Liquidaciones', path: '/settlements', icon: ReceiptText }] },
  { label: 'Inteligencia', items: [{ label: 'Conversión', path: '/analytics/conversion', icon: BarChart3 }, { label: 'Automatización', path: '/analytics/automation', icon: Gauge }, { label: 'Canales', path: '/analytics/channels', icon: Boxes }] },
  { label: 'Sistema', items: [{ label: 'Integraciones', path: '/integrations', icon: PackageCheck }, { label: 'Usuarios', path: '/users', icon: UsersRound }, { label: 'Configuración', path: '/settings', icon: Settings }, { label: 'Acuerdos', path: '/agreements', icon: CreditCard }, { label: 'Políticas', path: '/policies', icon: SlidersHorizontal }] },
]
