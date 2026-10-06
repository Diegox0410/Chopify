import { create } from 'zustand'

interface UIState { sidebarOpen: boolean; tenantScope: string; setSidebarOpen(open: boolean): void; toggleSidebar(): void; setTenantScope(scope: string): void }
export const useUIStore = create<UIState>((set) => ({ sidebarOpen: false, tenantScope: 'tenant-mg', setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }), toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })), setTenantScope: (tenantScope) => set({ tenantScope }) }))
