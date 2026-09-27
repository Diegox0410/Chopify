import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { CustomersPage } from '../features/customers/CustomersPage'
import { CustomerDetailPage } from '../features/customers/CustomerDetailPage'
import { OpportunitiesPage } from '../features/opportunities/OpportunitiesPage'
import { OpportunityDetailPage } from '../features/opportunities/OpportunityDetailPage'
import { ConversationsPage } from '../features/conversations/ConversationsPage'
import { ConversationDetailPage } from '../features/conversations/ConversationDetailPage'
import { ModulePlaceholder } from '../features/shell/ModulePlaceholder'
import { navigation } from './navigation'

export function App() { const implemented = new Set(['/customers', '/opportunities', '/conversations']); const paths = navigation.flatMap((section) => section.items).filter((item) => item.path !== '/' && !implemented.has(item.path)); return <BrowserRouter><Routes><Route element={<AppShell />}><Route index element={<DashboardPage />} /><Route path="customers" element={<CustomersPage />} /><Route path="customers/:tenantId/:customerId" element={<CustomerDetailPage />} /><Route path="opportunities" element={<OpportunitiesPage />} /><Route path="opportunities/:tenantId/:opportunityId" element={<OpportunityDetailPage />} /><Route path="conversations" element={<ConversationsPage />} /><Route path="conversations/:tenantId/:conversationId" element={<ConversationDetailPage />} />{paths.map((item) => <Route key={item.path} path={item.path} element={<ModulePlaceholder />} />)}<Route path="*" element={<ModulePlaceholder />} /></Route></Routes></BrowserRouter> }
