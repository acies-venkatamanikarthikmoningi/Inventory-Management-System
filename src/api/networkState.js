import { get } from './client'

export async function fetchNetworkState({ node } = {}) {
  return get('/api/v1/inventory/network-state', { node, pageSize: 500 })
}
