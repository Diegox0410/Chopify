import { BrowserRouter,Route,Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { navigation } from './navigation'
import { CatalogAdminPage } from '../features/catalog/CatalogAdminPage'
import { StorefrontPage } from '../features/catalog/StorefrontPage'
import { ConversationsPage } from '../features/conversations/ConversationsPage'
import { OperationalEmptyPage } from '../features/shell/OperationalEmptyPage'
import { OwnerPanelPage } from '../features/owner/OwnerPanelPage'
import '../styles/h3-operational.css';import '../styles/h3-final.css';import '../styles/h4-automation.css';import '../styles/h5-h7.css';import '../styles/h8-ganobot.css';import '../styles/h9-whatsapp.css';import '../styles/catalog.css'

export function App(){const reserved=new Set(['/products','/conversations']);const empty=navigation.flatMap(section=>section.items).filter(item=>item.path!=='/'&&!reserved.has(item.path));return <BrowserRouter><Routes><Route path="/" element={<StorefrontPage/>}/><Route path="store" element={<StorefrontPage/>}/><Route path="store/:slug" element={<StorefrontPage/>}/><Route path="owner" element={<OwnerPanelPage/>}/><Route path="owner/:storeSlug" element={<OwnerPanelPage/>}/><Route element={<AppShell/>}><Route path="dashboard" element={<OperationalEmptyPage title="Dashboard"/>}/><Route path="products" element={<CatalogAdminPage/>}/><Route path="conversations" element={<ConversationsPage/>}/>{empty.map(item=><Route key={item.path} path={item.path.slice(1)} element={<OperationalEmptyPage title={item.label}/>}/>) }<Route path="*" element={<OperationalEmptyPage title="Módulo"/>}/></Route></Routes></BrowserRouter>}
