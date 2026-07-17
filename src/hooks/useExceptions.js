import { useEffect, useState } from 'react'
import { fallbackExceptions, fallbackTransferCandidates } from '../api/fallback/exceptions'
import { fetchExceptions, fetchTransferCandidates } from '../api/exceptions'

export function useExceptions() {
  const [state, setState] = useState(() => ({ data: fallbackExceptions().items, source: 'fallback', error: null, loading: Boolean(import.meta.env.VITE_API_BASE_URL) }))
  useEffect(() => {
    let active = true
    if (!import.meta.env.VITE_API_BASE_URL) return undefined
    fetchExceptions().then(result => {
      if (active) setState({ data: result.items, source: 'api', error: null, loading: false })
    }).catch(error => {
      // Keep the fallback explicit; a failed configured API never masquerades as live data.
      if (active) setState({ data: fallbackExceptions().items, source: 'fallback', error: error.message, loading: false })
    })
    return () => { active = false }
  }, [])
  return state
}

export function useTransferCandidates() {
  const [state, setState] = useState(() => ({ data: fallbackTransferCandidates().items, source: 'fallback', error: null, loading: Boolean(import.meta.env.VITE_API_BASE_URL) }))
  useEffect(() => {
    let active = true
    if (!import.meta.env.VITE_API_BASE_URL) return undefined
    fetchTransferCandidates().then(result => {
      if (active) setState({ data: result.items, source: 'api', error: null, loading: false })
    }).catch(error => {
      if (active) setState({ data: fallbackTransferCandidates().items, source: 'fallback', error: error.message, loading: false })
    })
    return () => { active = false }
  }, [])
  return state
}
