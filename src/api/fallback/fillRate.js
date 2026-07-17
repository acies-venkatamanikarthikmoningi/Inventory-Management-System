// Same rule as Network Optimization (see fallback/optimization.js): a fabricated
// Fill Rate % would read as "this DC is performing at X%" when it is invented -
// actively misleading, unlike stale mock inventory data. No fake computed result
// here, only an explicit "unavailable" marker for the UI to render as an empty state.
export function fallbackFillRateUnavailable(reason) {
  return { unavailable: true, reason: reason || 'Fill Rate data unavailable' }
}
