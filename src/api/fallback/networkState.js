import inventory from '../../data/inventory.json'

export function fallbackNetworkState() {
  return { items: inventory, total: inventory.length, page: 1, pageSize: inventory.length }
}
