import type { AutomationActionType, AutonomyLevel } from './automation.js'
import type { TenantScoped } from './shared.js'

export type PaymentVerificationMode = 'MANUAL_OWNER' | 'MANUAL_AUTHORIZED_USER'
export interface CommercialPolicy extends TenantScoped { paymentVerificationMode: PaymentVerificationMode; allowAutomaticFollowUp: boolean; allowCartRecovery: boolean; allowPostSale: boolean; allowRepurchase: boolean }
export type CommercialAction = 'VERIFY_PAYMENT' | 'AUTOMATIC_FOLLOW_UP' | 'CART_RECOVERY' | 'POST_SALE' | 'REPURCHASE'
export type PolicyDecision = 'ALLOWED' | 'DENIED' | 'HUMAN_REQUIRED'
export function evaluateCommercialAction(policy: CommercialPolicy, action: CommercialAction): PolicyDecision {
  if (action === 'VERIFY_PAYMENT') return 'HUMAN_REQUIRED'
  const flags: Record<Exclude<CommercialAction, 'VERIFY_PAYMENT'>, boolean> = { AUTOMATIC_FOLLOW_UP: policy.allowAutomaticFollowUp, CART_RECOVERY: policy.allowCartRecovery, POST_SALE: policy.allowPostSale, REPURCHASE: policy.allowRepurchase }
  return flags[action] ? 'ALLOWED' : 'DENIED'
}

export interface AutomationPolicy extends TenantScoped {
  autonomyLevel: AutonomyLevel
  allowMessageRequests: boolean
  allowFollowUps: boolean
  allowRepurchase: boolean
  allowEscalations: boolean
}
export function evaluateAutomationAction(policy: AutomationPolicy, action: AutomationActionType): PolicyDecision {
  if (action === 'REQUEST_HUMAN_ESCALATION') return policy.allowEscalations ? 'ALLOWED' : 'DENIED'
  if (policy.autonomyLevel === 0) return 'DENIED'
  if (policy.autonomyLevel === 1) return 'HUMAN_REQUIRED'
  if (action === 'SEND_MESSAGE_REQUEST') return policy.allowMessageRequests && policy.autonomyLevel >= 2 ? 'ALLOWED' : 'HUMAN_REQUIRED'
  if (action === 'CREATE_FOLLOW_UP') return policy.allowFollowUps ? 'ALLOWED' : 'DENIED'
  if (action === 'CREATE_REPURCHASE_OPPORTUNITY') return policy.allowRepurchase ? 'ALLOWED' : 'DENIED'
  return 'DENIED'
}
