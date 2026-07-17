import { useEffect, useState } from 'react'
import { toInventoryRow } from '../api/contracts'
import { fallbackNetworkState } from '../api/fallback/networkState'
import { fetchNetworkState } from '../api/networkState'

export function useNetworkState(node) {
  const [state, setState] = useState(() => ({ data: fallbackNetworkState().items.map(toInventoryRow), source: 'fallback', error: null, loading: Boolean(import.meta.env.VITE_API_BASE_URL) }))
  useEffect(() => {
    let active = true
    if (!import.meta.env.VITE_API_BASE_URL) return undefined
    fetchNetworkState({ node }).then(result => {
      if (active) setState({ data: result.items.map(toInventoryRow), source: 'api', error: null, loading: false })
    }).catch(error => {
      // Keep the fallback explicit; a failed configured API never masquerades as live data.
      if (active) setState({ data: fallbackNetworkState().items.map(toInventoryRow), source: 'fallback', error: error.message, loading: false })
    })
    return () => { active = false }
  }, [node])
  return state
}
