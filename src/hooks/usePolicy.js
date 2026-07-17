import { useEffect, useState } from 'react'
import { toDriftRow } from '../api/contracts'
import { fallbackPolicyDrift } from '../api/fallback/policy'
import { fetchPolicyDrift } from '../api/policy'

// Fallback rows are already in the page's card shape (the pre-Phase-3 mock); API rows
// are mapped into that same shape via toDriftRow. Both branches converge to one shape.
export function usePolicyDrift() {
  const [state, setState] = useState(() => ({ data: fallbackPolicyDrift().items, source: 'fallback', error: null, loading: Boolean(import.meta.env.VITE_API_BASE_URL) }))
  useEffect(() => {
    let active = true
    if (!import.meta.env.VITE_API_BASE_URL) return undefined
    fetchPolicyDrift().then(result => {
      if (active) setState({ data: result.items.map(toDriftRow), source: 'api', error: null, loading: false })
    }).catch(error => {
      // Keep the fallback explicit; a failed configured API never masquerades as live data.
      if (active) setState({ data: fallbackPolicyDrift().items, source: 'fallback', error: error.message, loading: false })
    })
    return () => { active = false }
  }, [])
  return state
}
