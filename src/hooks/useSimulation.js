import { useCallback, useState } from 'react'
import { fetchSimulationResults, fetchSimulationRun } from '../api/simulation'
import { fallbackSimulationUnavailable } from '../api/fallback/simulation'

// Imperative, not fetch-on-mount - same rule as useOptimization.js: a Monte
// Carlo run is real compute, so it must only run on explicit user action,
// never automatically on page load or tab switch.
//
// Keyed by an arbitrary caller-chosen key (here, `${skuCode}|${node}`) since
// Policy Robustness shows one "Run Simulation" button per SKU/node row, each
// with its own independent run/result/loading state, not a single global run.
export function useSimulationRun() {
  const [byKey, setByKey] = useState({})

  const runSimulation = useCallback(async (key, payload = {}) => {
    if (!import.meta.env.VITE_API_BASE_URL) {
      setByKey(prev => ({ ...prev, [key]: { status: 'unavailable', run: null, results: [], error: fallbackSimulationUnavailable('VITE_API_BASE_URL is not configured').reason } }))
      return
    }
    setByKey(prev => ({ ...prev, [key]: { ...(prev[key] || {}), status: 'running', error: null } }))
    try {
      const run = await fetchSimulationRun(payload)
      const resultsResponse = await fetchSimulationResults(run.runId)
      setByKey(prev => ({ ...prev, [key]: { status: 'done', run, results: resultsResponse.items, error: null } }))
    } catch (error) {
      // No fake fallback data on failure - see src/api/fallback/simulation.js.
      setByKey(prev => ({ ...prev, [key]: { status: 'unavailable', run: null, results: [], error: fallbackSimulationUnavailable(error.message).reason } }))
    }
  }, [])

  return { byKey, runSimulation }
}
