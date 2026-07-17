import { useCallback, useEffect, useState } from 'react'
import { fetchPolicyRecommendations, refreshPolicyRecommendations } from '../api/policy'
import { fallbackPolicyRecommendationsUnavailable } from '../api/fallback/policyRecommendations'

// Fetch-on-mount for the READ (GET /policy/recommendations): cheap, since it
// only reads whatever the last network-wide evaluation persisted - it does
// NOT compute (see policy_recommendation_service.py's module docstring for
// why the evaluation itself is real Monte Carlo work, up to 5 simulations
// per SKU/node). No fake fallback data on failure - see
// fallback/policyRecommendations.js. Exposes `refetch` (e.g. after an
// Approve action changes the current policy) and `evaluateNetwork` - the
// EXPENSIVE action, only ever triggered by an explicit button click, never
// automatically on mount.
export function usePolicyRecommendations() {
  const [state, setState] = useState(() => ({ data: [], source: 'loading', error: null, loading: Boolean(import.meta.env.VITE_API_BASE_URL) }))
  const [evaluation, setEvaluation] = useState({ status: 'idle' })

  const load = useCallback(() => {
    if (!import.meta.env.VITE_API_BASE_URL) {
      setState({ data: [], source: 'unavailable', error: fallbackPolicyRecommendationsUnavailable('VITE_API_BASE_URL is not configured').reason, loading: false })
      return
    }
    fetchPolicyRecommendations().then(result => {
      setState({ data: result.items, source: 'api', error: null, loading: false })
    }).catch(error => {
      setState({ data: [], source: 'unavailable', error: fallbackPolicyRecommendationsUnavailable(error.message).reason, loading: false })
    })
  }, [])

  useEffect(() => { load() }, [load])

  const evaluateNetwork = useCallback(async () => {
    setEvaluation({ status: 'running' })
    try {
      const summary = await refreshPolicyRecommendations()
      setEvaluation({ status: 'done', summary })
      load()
    } catch (error) {
      setEvaluation({ status: 'error', error: error.message })
    }
  }, [load])

  return { ...state, refetch: load, evaluateNetwork, evaluation }
}
