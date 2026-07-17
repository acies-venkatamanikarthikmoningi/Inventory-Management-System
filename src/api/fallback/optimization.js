// Deliberate exception to this app's usual fallback pattern (see fallback/policy.js,
// fallback/exceptions.js, etc.): those fall back to illustrative-but-labeled mock data
// when the API is unavailable, because stale/mock inventory data just looks old to a
// planner. A fabricated optimization RECOMMENDATION is different in kind - it would
// read as "the solver decided to transfer/order this," which is actively misleading if
// invented rather than merely stale. So there is no fake result here, only an explicit
// "unavailable" marker for the UI to render as an empty state.
export function fallbackOptimizationUnavailable(reason) {
  return { unavailable: true, reason: reason || 'Optimization engine unavailable' }
}
