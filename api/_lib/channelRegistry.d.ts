export interface WhatsAppChannel { readonly tenantId: string; readonly provider: 'META'; readonly channel: 'WHATSAPP'; readonly externalChannelId: string; readonly accessTokenEnv: string; readonly status: 'ACTIVE' | 'CONFIGURED' }
export function whatsappChannels(): readonly WhatsAppChannel[]
export function resolveWhatsAppChannel(phoneNumberId: string): WhatsAppChannel | null
export function configuredWhatsAppTenants(): string[]
