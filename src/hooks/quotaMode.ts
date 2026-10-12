let quotaSafeMode = false

export function isQuotaSafeMode() { return quotaSafeMode }

export function setQuotaSafeMode(enabled: boolean) {
  if (quotaSafeMode === enabled) return
  quotaSafeMode = enabled
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('chopify-quota-mode-change'))
}
