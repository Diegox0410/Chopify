import type { EntityId, TenantScoped } from './shared'

export type AutomationStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
export type AutomationTriggerType = 'ORDER_CREATED' | 'PAYMENT_CONFIRMED' | 'ORDER_DISPATCHED' | 'ORDER_DELIVERED' | 'CART_ABANDONED' | 'REPURCHASE_WINDOW_REACHED'
export type AutomationActionType = 'CREATE_FOLLOW_UP' | 'CREATE_REPURCHASE_OPPORTUNITY' | 'REQUEST_HUMAN_ESCALATION' | 'SEND_MESSAGE_REQUEST'
export interface AutomationTrigger { type: AutomationTriggerType; config?: Readonly<Record<string, string | number | boolean>> }
export interface AutomationCondition { field: string; operator: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN'; value: string | number | boolean | readonly string[] }
export interface AutomationAction { type: AutomationActionType; config?: Readonly<Record<string, string | number | boolean>> }
export interface AutomationDefinition extends TenantScoped { id: EntityId; name: string; status: AutomationStatus; trigger: AutomationTrigger; conditions: readonly AutomationCondition[]; actions: readonly AutomationAction[] }
export const isExecutableAutomation = (definition: AutomationDefinition) => definition.status === 'ACTIVE' && definition.actions.length > 0
