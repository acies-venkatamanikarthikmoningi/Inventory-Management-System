import { get, post } from './client'

// L1 - Fill Rate
export async function fetchFillRateSummary({ node, dateFrom, dateTo } = {}) {
  return get('/api/v1/fill-rate/summary', { node, date_from: dateFrom, date_to: dateTo })
}

export async function fetchFillRateBySku({ node, dateFrom, dateTo } = {}) {
  return get('/api/v1/fill-rate/summary/by-sku', { node, date_from: dateFrom, date_to: dateTo })
}

// L2 - Diagnostics (Stockout Rate, Backorder Rate, Days of Supply)
export async function fetchDiagnostics({ node, skuCode, dateFrom, dateTo } = {}) {
  return get('/api/v1/fill-rate/diagnostics', { node, sku_code: skuCode, date_from: dateFrom, date_to: dateTo })
}

export async function fetchDiagnosticsBySku({ node, dateFrom, dateTo } = {}) {
  return get('/api/v1/fill-rate/diagnostics/by-sku', { node, date_from: dateFrom, date_to: dateTo })
}

// L3 - Driver Screening (5 raw driver flags per SKU)
export async function fetchDriverScreen({ dateFrom, dateTo } = {}) {
  return get('/api/v1/fill-rate/drivers/screen', { date_from: dateFrom, date_to: dateTo })
}

// L4 - Triage
export async function fetchTriage({ dateFrom, dateTo } = {}) {
  return get('/api/v1/fill-rate/triage', { date_from: dateFrom, date_to: dateTo })
}

// L4 - RCA (only valid for a sku/period Triage marked "responsible" - 400 otherwise)
export async function fetchRca(skuCode, { dateFrom, dateTo } = {}) {
  return get(`/api/v1/fill-rate/rca/${encodeURIComponent(skuCode)}`, { date_from: dateFrom, date_to: dateTo })
}

// L5 - Action. actions omitted approves every recommended action; pass a subset
// for partial approval.
export async function applyRecommendation(skuCode, { dateFrom, dateTo, approvedBy, actions } = {}) {
  return post(`/api/v1/fill-rate/rca/${encodeURIComponent(skuCode)}/apply`, {
    date_from: dateFrom, date_to: dateTo, approved_by: approvedBy, actions,
  })
}

// Measurement - before/after Fill Rate comparison for one sku
export async function fetchMeasurement(skuCode, { beforeFrom, beforeTo, afterFrom, afterTo } = {}) {
  return get(`/api/v1/fill-rate/measurement/${encodeURIComponent(skuCode)}`, {
    before_from: beforeFrom, before_to: beforeTo, after_from: afterFrom, after_to: afterTo,
  })
}
