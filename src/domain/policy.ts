import type { TenantScoped } from './shared'

export type PaymentVerificationMode = 'MANUAL_OWNER' | 'MANUAL_AUTHORIZED_USER'
export interface CommercialPolicy extends TenantScoped { paymentVerificationMode: PaymentVerificationMode; allowAutomaticFollowUp: boolean; allowCartRecovery: boolean; allowPostSale: boolean; allowRepurchase: boolean }
export type CommercialAction = 'VERIFY_PAYMENT' | 'AUTOMATIC_FOLLOW_UP' | 'CART_RECOVERY' | 'POST_SALE' | 'REPURCHASE'
export type PolicyDecision = 'ALLOWED' | 'DENIED' | 'HUMAN_REQUIRED'
export function evaluateCommercialAction(policy: CommercialPolicy, action: CommercialAction): PolicyDecision {
  if (action === 'VERIFY_PAYMENT') return 'HUMAN_REQUIRED'
  const flags: Record<Exclude<CommercialAction, 'VERIFY_PAYMENT'>, boolean> = { AUTOMATIC_FOLLOW_UP: policy.allowAutomaticFollowUp, CART_RECOVERY: policy.allowCartRecovery, POST_SALE: policy.allowPostSale, REPURCHASE: policy.allowRepurchase }
  return flags[action] ? 'ALLOWED' : 'DENIED'
}
