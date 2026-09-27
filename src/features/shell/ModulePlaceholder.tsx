import { Construction } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { navigation } from '../../app/navigation'

export function ModulePlaceholder() { const location = useLocation(); const item = navigation.flatMap((section) => section.items).find((entry) => entry.path === location.pathname); return <div className="page"><div className="page-heading"><div><span className="eyebrow">Módulo preparado</span><h1>{item?.label ?? 'Chopify'}</h1><p>El contrato de dominio está listo; la experiencia operativa se implementará en el hito correspondiente.</p></div></div><section className="panel placeholder"><div className="empty-icon"><Construction size={23} /></div><strong>Shell funcional, sin operación conectada</strong><p>Esta pantalla no ejecuta integraciones, pagos, mensajes ni automatizaciones reales.</p></section></div> }
