export interface ChannelInboundAuthRequest { headers?: Record<string, string | string[] | undefined> }
export function authorizeChannelInbound(request: ChannelInboundAuthRequest, env?: NodeJS.ProcessEnv): { tenantId: string; uid: string } | null
