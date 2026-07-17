import { useCallback, useState } from 'react'
import { fetchOptimizationRecommendations, fetchOptimizationRun } from '../api/optimization'
import { fallbackOptimizationUnavailable } from '../api/fallback/optimization'

// Imperative, not fetch-on-mount like usePolicyDrift - a solve is expensive (~8s of
// real CPU), so it must only run on explicit user action (Run Optimization button),
// never automatically on page load or tab switch.
export function useOptimizationRun() {
  const [state, setState] = useState({ status: 'idle', run: null, recommendations: [], error: null })

  const runOptimization = useCallback(async (payload = {}) => {
    if (!import.meta.env.VITE_API_BASE_URL) {
      setState({ status: 'unavailable', run: null, recommendations: [], error: fallbackOptimizationUnavailable('VITE_API_BASE_URL is not configured').reason })
      return
    }
    setState(prev => ({ ...prev, status: 'running', error: null }))
    try {
      const run = await fetchOptimizationRun(payload)
      const recommendationsResponse = await fetchOptimizationRecommendations(run.runId)
      setState({ status: 'done', run, recommendations: recommendationsResponse.items, error: null })
    } catch (error) {
      // No fake fallback data on failure - see src/api/fallback/optimization.js for why.
      setState({ status: 'unavailable', run: null, recommendations: [], error: fallbackOptimizationUnavailable(error.message).reason })
    }
  }, [])

  return { ...state, runOptimization }
}
