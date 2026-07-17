import { useCallback, useEffect, useState } from 'react'
import {
  applyRecommendation, fetchDiagnostics, fetchDiagnosticsBySku, fetchDriverScreen, fetchFillRateBySku,
  fetchFillRateSummary, fetchMeasurement, fetchRca, fetchTriage,
} from '../api/fillRate'
import { fallbackFillRateUnavailable } from '../api/fallback/fillRate'

// Same fetch-on-dependency-change pattern as usePolicyDrift: no fabricated
// fallback data on failure (see api/fallback/fillRate.js) - only an explicit
// "unavailable" status for the UI to render as an empty state.
function useAsyncSection(fetcher, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  useEffect(() => {
    let active = true
    if (!import.meta.env.VITE_API_BASE_URL) {
      setState({ status: 'unavailable', data: null, error: fallbackFillRateUnavailable('VITE_API_BASE_URL is not configured').reason })
      return undefined
    }
    setState(prev => ({ ...prev, status: 'loading', error: null }))
    fetcher()
      .then(data => { if (active) setState({ status: 'done', data, error: null }) })
      .catch(error => { if (active) setState({ status: 'unavailable', data: null, error: fallbackFillRateUnavailable(error.message).reason }) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

// Owns every section's data for the Fill Rate Intelligence page: L1/L2 (DC-level
// and by-SKU), L4 Triage, L3 raw driver flags, and - lazily, once Triage resolves -
// L4 RCA for every SKU Triage marked "responsible" (the same gate the backend
// itself enforces; RCA is never requested for any other status). RCA results are
// cached per sku/period so re-rendering the page never re-fetches them.
export function useFillRateIntelligence({ node, dateFrom, dateTo }) {
  const summary = useAsyncSection(() => fetchFillRateSummary({ node, dateFrom, dateTo }), [node, dateFrom, dateTo])
  const bySku = useAsyncSection(() => fetchFillRateBySku({ node, dateFrom, dateTo }), [node, dateFrom, dateTo])
  const diagnostics = useAsyncSection(() => fetchDiagnostics({ node, dateFrom, dateTo }), [node, dateFrom, dateTo])
  const diagnosticsBySku = useAsyncSection(() => fetchDiagnosticsBySku({ node, dateFrom, dateTo }), [node, dateFrom, dateTo])
  const triage = useAsyncSection(() => fetchTriage({ dateFrom, dateTo }), [dateFrom, dateTo])
  const driverScreen = useAsyncSection(() => fetchDriverScreen({ dateFrom, dateTo }), [dateFrom, dateTo])

  const [rcaBySku, setRcaBySku] = useState({}) // { [skuCode]: { status, data, error } }
  const [appliedActionsBySku, setAppliedActionsBySku] = useState({}) // { [skuCode]: Set<actionName> }

  // Reset both caches whenever the period changes - a new date range means a
  // genuinely new RCA result and a new "what's been approved for this period" slate.
  useEffect(() => { setRcaBySku({}); setAppliedActionsBySku({}) }, [dateFrom, dateTo])

  useEffect(() => {
    if (triage.status !== 'done') return
    const responsible = triage.data.items.filter(item => item.status === 'responsible')
    responsible.forEach(item => {
      setRcaBySku(prev => (prev[item.skuCode] ? prev : { ...prev, [item.skuCode]: { status: 'loading', data: null, error: null } }))
      fetchRca(item.skuCode, { dateFrom, dateTo })
        .then(data => setRcaBySku(prev => ({ ...prev, [item.skuCode]: { status: 'done', data, error: null } })))
        .catch(error => setRcaBySku(prev => ({ ...prev, [item.skuCode]: { status: 'error', data: null, error: error.message } })))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triage.status, triage.data, dateFrom, dateTo])

  // Approves a SUBSET (or all, if actions is omitted) of a sku's real recommended
  // actions - never a second, separate approval path; Section 3's RCA card and
  // Section 4's flat pending-actions list both call this same function.
  const approveActions = useCallback(async (skuCode, actions, approvedBy) => {
    const result = await applyRecommendation(skuCode, { dateFrom, dateTo, approvedBy, actions })
    setAppliedActionsBySku(prev => {
      const next = new Set(prev[skuCode] || [])
      result.actions.forEach(a => next.add(a.actionTaken))
      return { ...prev, [skuCode]: next }
    })
    return result
  }, [dateFrom, dateTo])

  return {
    summary, bySku, diagnostics, diagnosticsBySku, triage, driverScreen,
    rcaBySku, appliedActionsBySku, approveActions,
  }
}

// Measurement (Part D) for one sku - only ever shows a comparison once the
// "after" period genuinely has real order data (checked via the by-SKU summary,
// since the measurement endpoint itself doesn't expose totalOrders). Omits
// rather than shows a broken/empty comparison when no after-period data exists yet.
export function useMeasurement(skuCode, period) {
  const [state, setState] = useState({ status: 'idle', data: null, error: null })

  const load = useCallback(async () => {
    setState({ status: 'loading', data: null, error: null })
    try {
      const afterBySku = await fetchFillRateBySku({ dateFrom: period.afterFrom, dateTo: period.afterTo })
      const afterRow = afterBySku.items.find(item => item.skuCode === skuCode)
      if (!afterRow || !afterRow.totalOrders) {
        setState({ status: 'no-after-data', data: null, error: null })
        return
      }
      const data = await fetchMeasurement(skuCode, period)
      setState({ status: 'done', data, error: null })
    } catch (error) {
      setState({ status: 'error', data: null, error: error.message })
    }
  }, [skuCode, period])

  return { ...state, load }
}
