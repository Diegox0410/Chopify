import { useParams } from 'react-router-dom'
import { ConversationWorkspace } from './ConversationWorkspace'
export function ConversationDetailPage() {
  const { tenantId = 'tenant-floes', conversationId = '' } = useParams()
  return <ConversationWorkspace key={`${tenantId}:${conversationId}`} initialTenant={tenantId} initialConversation={conversationId} />
}
