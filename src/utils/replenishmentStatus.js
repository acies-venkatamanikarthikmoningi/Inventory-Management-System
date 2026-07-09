import { getInventoryUomSimulation } from './uomDisplay'

export const NODE_DB_NAME = {
  'Mumbai Distribution Center': 'Mumbai Distribution Center',
  'Pune Distribution Center': 'Pune Warehouse',
  'Hyderabad Distribution Center': 'Hyderabad Plant',
  'Bangalore Distribution Center': 'Bangalore Distribution Center',
  'Chennai Distribution Center': 'Chennai Distribution Center',
}

export const UOM_LEVEL = {
  Each: 'L0',
  Case: 'L1',
  Pallet: 'L2',
}

const ACTIVE_ASN_STATUSES = new Set(['Pending', 'Received (GRN Submitted)'])

export const normalizeNode = node => NODE_DB_NAME[node] || node || 'Chennai Distribution Center'

export const breachKey = row => `${row.skuCode}-${row.level}`

export const getSkuNameMap = skuData => {
  const map = new Map()
  skuData.forEach(sku => map.set(sku.skuCode, sku.skuName || sku.skuCode))
  return map
}

export const getInventoryTotalsByLevel = (inventoryData, node) => {
  const targetNode = normalizeNode(node)
  const totals = new Map()

  inventoryData
    .filter(item => item.node === targetNode)
    .forEach(item => {
      const simulation = getInventoryUomSimulation(item)
      const level = UOM_LEVEL[simulation.type] || 'L0'
      const current = totals.get(item.skuCode) || { L0: 0, L1: 0, L2: 0 }
      current[level] += Number(simulation.quantity || 0)
      totals.set(item.skuCode, current)
    })

  return totals
}

export const hasActiveReplenishmentAsn = (asns, skuCode, node, level) => {
  const targetNode = normalizeNode(node)
  return asns.some(asn => {
    if (!ACTIVE_ASN_STATUSES.has(asn.status)) return false
    if (asn.node && normalizeNode(asn.node) !== targetNode) return false
    return asn.lines?.some(line => {
      if (line.skuCode !== skuCode) return false
      return !line.level || !level || line.level === level
    })
  })
}

export const getReplenishmentBreaches = ({ inventoryData, node, replenishmentConfig, skuData = [], asns = [] }) => {
  const totals = getInventoryTotalsByLevel(inventoryData, node)
  const skuNames = getSkuNameMap(skuData)

  return replenishmentConfig.flatMap(config => {
    const currentLevels = totals.get(config.skuCode) || { L0: 0, L1: 0, L2: 0 }

    return Object.entries(config.levels || {}).map(([level, settings]) => {
      const currentQty = currentLevels[level] || 0
      const minQty = Number(settings.min || 0)
      const maxQty = Number(settings.max || minQty)
      const hasAsn = hasActiveReplenishmentAsn(asns, config.skuCode, node, level)
      const suggestedQty = Math.max(1, maxQty - currentQty)

      return {
        key: `${config.skuCode}-${level}`,
        skuCode: config.skuCode,
        skuName: skuNames.get(config.skuCode) || config.skuCode,
        level,
        currentQty,
        minQty,
        maxQty,
        uom: settings.uom,
        autoApprove: Boolean(config.autoApprove),
        hasAsn,
        suggestedQty,
        belowMin: currentQty < minQty,
      }
    }).filter(row => row.belowMin)
  })
}

export const getRowReplenishmentStatus = ({ item, inventoryData, node, replenishmentConfig, asns }) => {
  const simulation = getInventoryUomSimulation(item)
  const level = UOM_LEVEL[simulation.type] || 'L0'
  const totals = getInventoryTotalsByLevel(inventoryData, node)
  const config = replenishmentConfig.find(record => record.skuCode === item.skuCode)
  const settings = config?.levels?.[level]

  if (!settings) return null

  const currentQty = totals.get(item.skuCode)?.[level] || 0
  if (currentQty >= Number(settings.min || 0)) return null

  const hasAsn = hasActiveReplenishmentAsn(asns, item.skuCode, node, level)
  return hasAsn
    ? { label: 'Replenishment Triggered', className: 'badge-warning' }
    : { label: 'Pending Approval', className: 'badge-default' }
}
