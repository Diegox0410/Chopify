import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { ModulePlaceholder } from '../features/shell/ModulePlaceholder'
import { navigation } from './navigation'

export function App() { const paths = navigation.flatMap((section) => section.items).filter((item) => item.path !== '/'); return <BrowserRouter><Routes><Route element={<AppShell />}><Route index element={<DashboardPage />} />{paths.map((item) => <Route key={item.path} path={item.path} element={<ModulePlaceholder />} />)}<Route path="*" element={<ModulePlaceholder />} /></Route></Routes></BrowserRouter> }
