// Same deliberate exception as fallback/optimization.js and fallback/simulation.js:
// a fabricated policy-type recommendation (with invented reasoning) would be actively
// misleading - a planner could believe the engine analyzed real data when it didn't -
// so there is no fake result here, only an explicit "unavailable" marker.
export function fallbackPolicyRecommendationsUnavailable(reason) {
  return { unavailable: true, reason: reason || 'Policy recommendation engine unavailable' }
}
