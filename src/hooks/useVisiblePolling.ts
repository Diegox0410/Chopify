import { useEffect } from 'react'
import { isQuotaSafeMode } from './quotaMode'

export function pollingDelay(attempt: number, baseMs: number, maxMs: number, random = Math.random) {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  return Math.round(Math.min(maxMs, exponential * (0.8 + random() * 0.4)))
}

export function useVisiblePolling(load: () => Promise<boolean>, intervalMs: number, maxBackoffMs = 120_000) {
  useEffect(() => {
    let timer: number | undefined
    let stopped = false
    let attempt = 0

    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }
    const schedule = (delay: number) => {
      clear()
      if (!stopped && document.visibilityState === 'visible') {
        timer = window.setTimeout(() => void tick(), delay)
      }
    }
    const currentInterval = () => isQuotaSafeMode() ? Math.max(intervalMs * 4, 120_000) : intervalMs
    const tick = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      const succeeded = await load().catch(() => false)
      if (stopped || document.visibilityState !== 'visible') return
      attempt = succeeded ? 0 : attempt + 1
      const base = currentInterval()
      schedule(succeeded ? base : pollingDelay(attempt - 1, base, Math.max(maxBackoffMs, base)))
    }
    const onVisibilityChange = () => {
      clear()
      if (document.visibilityState === 'visible') {
        attempt = 0
        void tick()
      }
    }
    const onQuotaModeChange = () => {
      clear()
      if (document.visibilityState !== 'visible') return
      if (isQuotaSafeMode()) schedule(currentInterval())
      else void tick()
    }

    if (document.visibilityState === 'visible') void tick()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('chopify-quota-mode-change', onQuotaModeChange)
    return () => {
      stopped = true
      clear()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('chopify-quota-mode-change', onQuotaModeChange)
    }
  }, [load, intervalMs, maxBackoffMs])
}
