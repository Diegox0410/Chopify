import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { CustomersPage } from '../features/customers/CustomersPage'
import { CustomerDetailPage } from '../features/customers/CustomerDetailPage'
import { OpportunitiesPage } from '../features/opportunities/OpportunitiesPage'
import { OpportunityDetailPage } from '../features/opportunities/OpportunityDetailPage'
import { ConversationsPage } from '../features/conversations/ConversationsPage'
import { ConversationDetailPage } from '../features/conversations/ConversationDetailPage'
import { OrdersPage } from '../features/orders/OrdersPage'
import { OrderDetailPage } from '../features/orders/OrderDetailPage'
import { PaymentReviewPage } from '../features/payments/PaymentReviewPage'
import { FulfillmentPage } from '../features/fulfillment/FulfillmentPage'
import { ExceptionsPage } from '../features/exceptions/ExceptionsPage'
import { AutomationsPage } from '../features/automations/AutomationsPage'
import { ModulePlaceholder } from '../features/shell/ModulePlaceholder'
import { navigation } from './navigation'
import '../styles/h3-operational.css'
import '../styles/h3-final.css'
import '../styles/h4-automation.css'
export function App() {
 const implemented=new Set(['/customers','/opportunities','/conversations','/orders','/payments/review','/fulfillment','/exceptions','/automations'])
 const paths=navigation.flatMap((s)=>s.items).filter((i)=>i.path!=='/'&&!implemented.has(i.path))
 return <BrowserRouter><Routes><Route element={<AppShell/>}><Route index element={<DashboardPage/>}/><Route path="customers" element={<CustomersPage/>}/><Route path="customers/:tenantId/:customerId" element={<CustomerDetailPage/>}/><Route path="opportunities" element={<OpportunitiesPage/>}/><Route path="opportunities/:tenantId/:opportunityId" element={<OpportunityDetailPage/>}/><Route path="conversations" element={<ConversationsPage/>}/><Route path="conversations/:tenantId/:conversationId" element={<ConversationDetailPage/>}/><Route path="orders" element={<OrdersPage/>}/><Route path="orders/:tenantId/:orderId" element={<OrderDetailPage/>}/><Route path="payments" element={<PaymentReviewPage/>}/><Route path="payments/review" element={<PaymentReviewPage/>}/><Route path="fulfillment" element={<FulfillmentPage/>}/><Route path="exceptions" element={<ExceptionsPage/>}/><Route path="automations" element={<AutomationsPage/>}/>{paths.map((i)=><Route key={i.path} path={i.path} element={<ModulePlaceholder/>}/>) }<Route path="*" element={<ModulePlaceholder/>}/></Route></Routes></BrowserRouter>
}
