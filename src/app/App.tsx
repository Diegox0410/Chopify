import { BrowserRouter,Navigate,Route,Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { navigation } from './navigation'
import { CatalogAdminPage } from '../features/catalog/CatalogAdminPage'
import { StorefrontPage } from '../features/catalog/StorefrontPage'
import { ConversationsPage } from '../features/conversations/ConversationsPage'
import { OperationalEmptyPage } from '../features/shell/OperationalEmptyPage'
import { IntegrationsPage, RealBusinessesPage, RealCustomersPage, RealDashboardPage, RealExceptionsPage, RealFulfillmentPage, RealOpportunitiesPage, RealOrdersPage, RealPaymentReviewPage } from '../features/platform/AdminCenters'
import { OwnerPanelPage } from '../features/owner/OwnerPanelPage'
import { LoginPage } from '../auth/LoginPage'
import { RequireAuth } from '../auth/RequireAuth'
import '../styles/h3-operational.css'
import '../styles/h3-final.css'
import '../styles/h4-automation.css'
import '../styles/h5-h7.css'
import '../styles/h8-ganobot.css'
import '../styles/h9-whatsapp.css'
import '../styles/catalog.css'

export function App(){
  const reserved=new Set(['/products','/conversations','/businesses','/customers','/opportunities','/orders','/payments/review','/fulfillment','/exceptions','/integrations'])
  const empty=navigation
    .flatMap(section=>section.items)
    .filter(item=>item.path!=='/'&&!reserved.has(item.path))

  return <BrowserRouter>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
      <Route path="store" element={<StorefrontPage/>}/>
      <Route path="store/:slug" element={<StorefrontPage/>}/>

      <Route path="owner" element={<OwnerPanelPage/>}/>
      <Route path="owner/:storeSlug" element={<OwnerPanelPage/>}/>

      <Route path="login" element={<LoginPage/>}/>

      <Route
        element={
          <RequireAuth>
            <AppShell/>
          </RequireAuth>
        }
      >
        <Route path="dashboard" element={<RealDashboardPage/>}/>
        <Route path="products" element={<CatalogAdminPage/>}/>
        <Route path="conversations" element={<ConversationsPage/>}/>
        <Route path="businesses" element={<RealBusinessesPage/>}/>
        <Route path="orders" element={<RealOrdersPage/>}/>
        <Route path="customers" element={<RealCustomersPage/>}/>
        <Route path="opportunities" element={<RealOpportunitiesPage/>}/>
        <Route path="payments/review" element={<RealPaymentReviewPage/>}/>
        <Route path="fulfillment" element={<RealFulfillmentPage/>}/>
        <Route path="exceptions" element={<RealExceptionsPage/>}/>
        <Route path="integrations" element={<IntegrationsPage/>}/>

        {empty.map(item=>
          <Route
            key={item.path}
            path={item.path.slice(1)}
            element={<OperationalEmptyPage title={item.label}/>}
          />
        )}

        <Route path="*" element={<OperationalEmptyPage title="Módulo"/>}/>
      </Route>
    </Routes>
  </BrowserRouter>
}
