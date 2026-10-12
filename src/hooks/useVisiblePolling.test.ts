import { describe, expect, it } from 'vitest'
import { pollingDelay } from './useVisiblePolling'

describe('pollingDelay', () => {
  it('backs off exponentially with bounded jitter', () => {
    expect(pollingDelay(0, 15_000, 120_000, () => 0)).toBe(12_000)
    expect(pollingDelay(1, 15_000, 120_000, () => 0.5)).toBe(30_000)
    expect(pollingDelay(8, 15_000, 120_000, () => 1)).toBe(120_000)
  })
})
