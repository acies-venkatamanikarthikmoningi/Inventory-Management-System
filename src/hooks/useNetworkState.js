import { useEffect, useState } from 'react'
import { toInventoryRow } from '../api/contracts'
import { fallbackNetworkState } from '../api/fallback/networkState'
import { fetchNetworkState } from '../api/networkState'

const CACHE_KEY = 'inventiq_network_state_cache'

function readCachedNetworkState() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.data)) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCachedNetworkState(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }))
  } catch {
    // Ignore storage failures; cache is only a performance hint.
  }
}

export function useNetworkState(node) {
  const [state, setState] = useState(() => {
    const cached = readCachedNetworkState()
    if (cached) {
      return { data: cached, source: 'cache', error: null, loading: Boolean(import.meta.env.VITE_API_BASE_URL) }
    }
    return { data: fallbackNetworkState().items.map(toInventoryRow), source: 'fallback', error: null, loading: Boolean(import.meta.env.VITE_API_BASE_URL) }
  })
  useEffect(() => {
    let active = true
    if (!import.meta.env.VITE_API_BASE_URL) return undefined
    fetchNetworkState({ node }).then(result => {
      const data = result.items.map(toInventoryRow)
      writeCachedNetworkState(data)
      if (active) setState({ data, source: 'api', error: null, loading: false })
    }).catch(error => {
      // Keep the fallback explicit; a failed configured API never masquerades as live data.
      if (active) setState({ data: fallbackNetworkState().items.map(toInventoryRow), source: 'fallback', error: error.message, loading: false })
    })
    return () => { active = false }
  }, [node])
  return state
}
