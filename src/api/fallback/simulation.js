// Same deliberate exception as fallback/optimization.js: a fabricated
// current-vs-optimized robustness comparison would be actively misleading (a
// planner could believe the optimizer was proven better/worse when no real
// simulation ran), so there is no fake result here - only an explicit
// "unavailable" marker.
export function fallbackSimulationUnavailable(reason) {
  return { unavailable: true, reason: reason || 'Simulation engine unavailable' }
}
