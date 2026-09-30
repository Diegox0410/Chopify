import { describe, expect, it } from 'vitest'
import type { CommercialTask, Conversation, Opportunity } from './index.js'
import { abandonOpportunity, assignHumanConversation, calculateConversionMetrics, cancelTask, closeConversation, completeTask, createCommercialNote, loseOpportunity, markOpportunityOrderCreated, projectAttention, projectPipeline, qualifyOpportunity, reopenConversation, reopenOpportunity, requireHumanConversation, startOpportunityCart, updateOpportunityEstimatedValue, winOpportunity } from './index.js'

const now = '2026-09-27T10:00:00.000Z'
const conversation: Conversation = { id: 'conv', tenantId: 'tenant-a', customerId: 'customer-a', channel: 'WEB', status: 'OPEN', assignedMode: 'AUTOMATION', startedAt: now, lastActivityAt: now, createdAt: now, updatedAt: now }
const opportunity = (status: Opportunity['status'] = 'OPEN'): Opportunity => ({ id: 'opp', tenantId: 'tenant-a', customerId: 'customer-a', intent: 'PURCHASE_INTENT', status, estimatedValueCents: 1000, currency: 'COP', createdAt: now, updatedAt: now })
const task: CommercialTask = { id: 'task', tenantId: 'tenant-a', customerId: 'customer-a', title: 'Follow up', priority: 'HIGH', status: 'OPEN', createdAt: now }

describe('conversation state machine', () => {
  it('requires human without losing tenant ownership', () => expect(requireHumanConversation(conversation, '2026-09-28')).toMatchObject({ tenantId: 'tenant-a', status: 'HUMAN_REQUIRED', assignedMode: 'AUTOMATION' }))
  it('assigns a human only from HUMAN_REQUIRED', () => expect(assignHumanConversation(requireHumanConversation(conversation, now), 'user-1', now)).toMatchObject({ status: 'OPEN', assignedMode: 'HUMAN', assignedUserId: 'user-1' }))
  it('rejects human assignment from OPEN', () => expect(() => assignHumanConversation(conversation, 'user-1', now)).toThrow(/human-required/))
  it('closes and records closedAt', () => expect(closeConversation(conversation, now)).toMatchObject({ status: 'CLOSED', closedAt: now }))
  it('only reopens explicitly from CLOSED', () => { expect(reopenConversation(closeConversation(conversation, now), '2026-09-28')).toMatchObject({ status: 'OPEN', closedAt: undefined }); expect(() => reopenConversation(conversation, now)).toThrow(/closed/) })
})

describe('opportunity state machine', () => {
  it('supports the complete happy path', () => { const won = winOpportunity(markOpportunityOrderCreated(startOpportunityCart(qualifyOpportunity(opportunity(), now), now), now), now); expect(won.status).toBe('WON'); expect(won.wonAt).toBe(now) })
  it('rejects an invalid direct win', () => expect(() => winOpportunity(opportunity(), now)).toThrow(/Invalid/))
  it('keeps WON terminal', () => expect(() => loseOpportunity(opportunity('WON'), 'PRICE', now)).toThrow(/Invalid/))
  it('keeps LOST terminal by default', () => expect(() => reopenOpportunity(opportunity('LOST'), now)).toThrow(/Invalid/))
  it('reopens ABANDONED only with its explicit operation', () => expect(reopenOpportunity(opportunity('ABANDONED'), now)).toMatchObject({ status: 'OPEN', abandonedAt: undefined }))
  it('records abandonment reason', () => expect(abandonOpportunity(opportunity(), now, 'No response')).toMatchObject({ status: 'ABANDONED', abandonedReason: 'No response', abandonedAt: now }))
  it('records typed loss reason', () => expect(loseOpportunity(opportunity(), 'NO_STOCK', now)).toMatchObject({ status: 'LOST', lostReason: 'NO_STOCK', lostAt: now }))
  it('requires detail for OTHER loss', () => expect(() => loseOpportunity(opportunity(), 'OTHER', now)).toThrow(/requires detail/))
  it('accepts OTHER with trimmed detail', () => expect(loseOpportunity(opportunity(), 'OTHER', now, ' custom reason ')).toMatchObject({ lostReasonDetail: 'custom reason' }))
  it('accepts only non-negative integer cents', () => { expect(updateOpportunityEstimatedValue(opportunity(), 1250, now).estimatedValueCents).toBe(1250); expect(() => updateOpportunityEstimatedValue(opportunity(), 1.5, now)).toThrow(/integer/); expect(() => updateOpportunityEstimatedValue(opportunity(), -1, now)).toThrow(/non-negative/) })
})

describe('commercial notes and tasks', () => {
  it('trims a valid commercial note', () => expect(createCommercialNote({ id: 'n', tenantId: 'tenant-a', customerId: 'customer-a', authorId: 'u', body: ' hello ', createdAt: now }).body).toBe('hello'))
  it('rejects an empty commercial note', () => expect(() => createCommercialNote({ id: 'n', tenantId: 'tenant-a', customerId: 'customer-a', authorId: 'u', body: '  ', createdAt: now })).toThrow(/empty/))
  it('completes only an open task', () => { const completed = completeTask(task, now); expect(completed).toMatchObject({ status: 'COMPLETED', completedAt: now }); expect(() => completeTask(completed, now)).toThrow(/open/) })
  it('cancels only an open task', () => { const cancelled = cancelTask(task); expect(cancelled.status).toBe('CANCELLED'); expect(() => cancelTask(cancelled)).toThrow(/open/) })
})

describe('pipeline and conversion projections', () => {
  const items = [opportunity('OPEN'), { ...opportunity('QUALIFIED'), id: '2', estimatedValueCents: 2000 }, { ...opportunity('ORDER_CREATED'), id: '3', estimatedValueCents: 3000 }, { ...opportunity('WON'), id: '4', estimatedValueCents: 4000 }, { ...opportunity('LOST'), id: '5', estimatedValueCents: 5000 }, { ...opportunity('ABANDONED'), id: '6', estimatedValueCents: 6000 }]
  it('counts every pipeline status', () => expect(projectPipeline(items).countByStatus).toMatchObject({ OPEN: 1, QUALIFIED: 1, ORDER_CREATED: 1, WON: 1, LOST: 1, ABANDONED: 1 }))
  it('sums value by status', () => expect(projectPipeline(items).estimatedValueByStatus.QUALIFIED).toBe(2000))
  it('excludes closed states from open pipeline value', () => expect(projectPipeline(items).totalOpenPipelineValue).toBe(6000))
  it('uses total opportunities as qualification and order denominators', () => expect(calculateConversionMetrics(items)).toMatchObject({ qualificationRate: 3 / 6, orderCreationRate: 2 / 6 }))
  it('defines win rate as WON divided by WON plus LOST', () => expect(calculateConversionMetrics(items).winRate).toBe(0.5))
  it('returns zero rates for zero denominators and projects attention separately', () => { expect(calculateConversionMetrics([])).toMatchObject({ qualificationRate: 0, orderCreationRate: 0, winRate: 0 }); const attention = projectAttention([], [{ ...conversation, status: 'HUMAN_REQUIRED' }], [task], '2026-09-28'); expect(attention.map((item) => item.sourceType)).toEqual(['CONVERSATION', 'COMMERCIAL_TASK']) })
})
