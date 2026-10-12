export interface LiveDocument {
  id: string
  tenantId: string
  [key: string]: string
}

export function createDoc(id: string, data: Record<string, string | number | boolean | undefined>): Promise<boolean>
export function getDoc(id: string): Promise<LiveDocument | null>
export function listLiveDocuments(tenantId: string, limit?: number): Promise<LiveDocument[]>
export function listLiveDocumentsForTenants(tenantIds: string[], limit?: number): Promise<LiveDocument[]>
export function updateDoc(id: string, data: Record<string, string | number | boolean | undefined>): Promise<void>
export function sendOutbound(id: string): Promise<{ status: string; [key: string]: unknown }>
