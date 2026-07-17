import { get, post } from './client'

export async function fetchSimulationRun(payload = {}) {
  return post('/api/v1/simulation/run', payload)
}

export async function fetchSimulationResults(runId) {
  return get('/api/v1/simulation/results', { runId })
}
