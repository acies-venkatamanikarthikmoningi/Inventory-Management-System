import inventory from '../../data/inventory.json'

const NEAR_EXPIRY_DAYS = 90
const CRITICAL_EXPIRY_DAYS = 30
const MIN_SHELF_LIFE_FRACTION = 0.6

const daysBetween = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000)

function shelfLifeFeasible(item, asOf) {
  const totalLifeDays = daysBetween(item.mfgDate, item.expiry)
  if (totalLifeDays <= 0) return false
  const remainingDays = daysBetween(asOf, item.expiry)
  return remainingDays / totalLifeDays >= MIN_SHELF_LIFE_FRACTION
}

// Local, client-side approximation of the backend's exception rules, used only when the
// configured API is unreachable; never presented to the user as live data (see useExceptions).
export function fallbackExceptions(asOf = new Date().toISOString().slice(0, 10)) {
  const items = []
  for (const item of inventory) {
    if (!item.expiry) continue
    const daysRemaining = daysBetween(asOf, item.expiry)
    if (daysRemaining < 0) {
      items.push({ positionId: item.id, skuCode: item.skuCode, skuName: item.skuName, node: item.node, batch: item.batch, exceptionType: 'EXPIRED', severity: 'Critical', message: `${item.skuName} batch ${item.batch} expired on ${item.expiry}.`, expiryDate: item.expiry, daysRemaining, availableQty: item.availableQty })
    } else if (daysRemaining <= NEAR_EXPIRY_DAYS) {
      items.push({ positionId: item.id, skuCode: item.skuCode, skuName: item.skuName, node: item.node, batch: item.batch, exceptionType: 'NEAR_EXPIRY', severity: daysRemaining <= CRITICAL_EXPIRY_DAYS ? 'Critical' : 'High', message: `${item.skuName} batch ${item.batch} expires in ${daysRemaining} day(s) (${item.expiry}).`, expiryDate: item.expiry, daysRemaining, availableQty: item.availableQty })
      if (!shelfLifeFeasible(item, asOf)) {
        items.push({ positionId: item.id, skuCode: item.skuCode, skuName: item.skuName, node: item.node, batch: item.batch, exceptionType: 'SHELF_LIFE_INFEASIBLE', severity: 'Medium', message: `${item.skuName} batch ${item.batch} no longer meets the minimum ${MIN_SHELF_LIFE_FRACTION * 100}% shelf-life-remaining threshold for outbound dispatch.`, expiryDate: item.expiry, daysRemaining, availableQty: item.availableQty })
      }
    } else if (!shelfLifeFeasible(item, asOf)) {
      items.push({ positionId: item.id, skuCode: item.skuCode, skuName: item.skuName, node: item.node, batch: item.batch, exceptionType: 'SHELF_LIFE_INFEASIBLE', severity: 'Medium', message: `${item.skuName} batch ${item.batch} no longer meets the minimum ${MIN_SHELF_LIFE_FRACTION * 100}% shelf-life-remaining threshold for outbound dispatch.`, expiryDate: item.expiry, daysRemaining, availableQty: item.availableQty })
    }
    if ((item.status || '').toLowerCase() === 'critical') {
      items.push({ positionId: item.id, skuCode: item.skuCode, skuName: item.skuName, node: item.node, batch: item.batch, exceptionType: 'BACKORDER_RISK', severity: 'High', message: `${item.skuName} at ${item.node} is flagged Critical (available ${item.availableQty}).`, expiryDate: item.expiry, daysRemaining, availableQty: item.availableQty })
    }
  }
  return { items, total: items.length }
}

export function fallbackTransferCandidates(asOf = new Date().toISOString().slice(0, 10)) {
  const face = zoneCode => (zoneCode && zoneCode.includes('PK') ? 'PICK' : 'RESERVE')
  const pickBinsBySkuNode = new Map()
  for (const item of inventory) {
    if (face(item.zoneCode) === 'PICK') {
      const key = `${item.skuCode}::${item.node}`
      if (!pickBinsBySkuNode.has(key)) pickBinsBySkuNode.set(key, item)
    }
  }
  const items = []
  for (const item of inventory) {
    if (face(item.zoneCode) === 'PICK' || !item.expiry) continue
    const daysRemaining = daysBetween(asOf, item.expiry)
    if (daysRemaining < 0 || item.availableQty <= 0) continue
    const isNearExpiry = daysRemaining <= NEAR_EXPIRY_DAYS
    const isInfeasible = !shelfLifeFeasible(item, asOf)
    if (!isNearExpiry && !isInfeasible) continue
    const target = pickBinsBySkuNode.get(`${item.skuCode}::${item.node}`)
    if (!target) continue
    const reason = isNearExpiry ? `expires in ${daysRemaining} day(s)` : 'fails the minimum shelf-life-remaining threshold'
    items.push({
      skuCode: item.skuCode, skuName: item.skuName, batch: item.batch,
      fromNode: item.node, fromZone: item.zoneCode, fromBin: item.binCode,
      toZone: target.zoneCode, toBin: target.binCode, suggestedQty: item.availableQty,
      reason: `Batch ${reason}; prioritize move from reserve to pick face for FEFO dispatch.`,
    })
  }
  return { items, total: items.length }
}
