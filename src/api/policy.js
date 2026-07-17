import { get, post } from './client'

const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')

export async function fetchPolicyDrift() {
  return get('/api/v1/policy/drift')
}

export async function fetchPolicyRecommendations() {
  return get('/api/v1/policy/recommendations')
}

// Expensive - runs real Monte Carlo simulations per SKU/node (see
// policy_recommendation_service.py) - only ever called from an explicit
// "Evaluate Network" button click, never fetch-on-mount. Query-param POST
// (no body), same shape as refreshPolicy() below.
export async function refreshPolicyRecommendations(params = {}) {
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is not configured')
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  const response = await fetch(`${baseUrl}/api/v1/policy/recommendations/refresh${query.size ? `?${query}` : ''}`, { method: 'POST' })
  if (!response.ok) throw new Error(`API request failed (${response.status})`)
  return response.json()
}

export async function fetchPolicyAuditLog(params = {}) {
  return get('/api/v1/policy/audit-log', params)
}

export async function approvePolicyChange(payload) {
  return post('/api/v1/policy/approve-change', payload)
}

export async function refreshPolicy() {
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is not configured')
  const response = await fetch(`${baseUrl}/api/v1/policy/refresh`, { method: 'POST' })
  if (!response.ok) throw new Error(`API request failed (${response.status})`)
  return response.json()
}
