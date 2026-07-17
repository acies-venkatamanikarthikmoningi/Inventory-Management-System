import { get } from './client'

export async function fetchExceptions() {
  return get('/api/v1/inventory/exceptions')
}

export async function fetchTransferCandidates() {
  return get('/api/v1/inventory/transfer-candidates')
}
