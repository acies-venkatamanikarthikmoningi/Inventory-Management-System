import { get, post } from './client'

export async function fetchOptimizationRun(payload = {}) {
  return post('/api/v1/optimization/run', payload)
}

export async function fetchOptimizationRecommendations(runId) {
  return get('/api/v1/optimization/recommendations', { runId })
}
