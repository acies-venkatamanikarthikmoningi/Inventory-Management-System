// This mapper is the compatibility boundary: UI field names remain stable while API DTOs evolve.
export function toInventoryRow(item) {
  return {
    ...item,
    location: item.binDescription ? `${item.binCode} - ${item.zoneCode}` : item.location,
    areaCode: item.areaCode,
    areaDescription: item.areaDescription,
    zoneCode: item.zoneCode,
    zoneDescription: item.zoneDescription,
    binCode: item.binCode,
    binDescription: item.binDescription,
    shelfLife: item.shelfLifeMonths ?? item.shelfLife,
  }
}

// Maps a backend ExceptionItem/TransferCandidate into the InventoryInsights card shape.
export function toInsightRow(exception) {
  const isExpiry = exception.exceptionType === 'EXPIRED' || exception.exceptionType === 'NEAR_EXPIRY' || exception.exceptionType === 'SHELF_LIFE_INFEASIBLE'
  const typeLabel = {
    EXPIRED: 'Expired Batch Alert',
    NEAR_EXPIRY: 'Near Expiry Alert',
    SHELF_LIFE_INFEASIBLE: 'Shelf-Life Feasibility Alert',
    BACKORDER_RISK: 'Low Stock Alert',
  }[exception.exceptionType] || exception.exceptionType
  return {
    id: `EXC-${exception.positionId}-${exception.exceptionType}`,
    type: typeLabel,
    priority: exception.severity === 'Critical' ? 'Critical' : exception.severity === 'High' ? 'High' : 'Medium',
    severity: exception.severity,
    sku: exception.batch,
    impact: `${exception.availableQty.toLocaleString()} units of ${exception.skuCode} at ${exception.node}`,
    message: exception.message,
    recommendation: isExpiry
      ? 'Prioritize dispatch of this batch or plan a write-off before expiry.'
      : 'Raise a replenishment order or investigate the shortage at this node.',
    status: 'Open',
    category: isExpiry ? 'Expiry' : 'Stock',
    assignedTo: 'Unassigned',
    createdAt: '',
    source: 'api',
  }
}

const DRIFT_ACTION_LABEL = { 'Safety Stock': 'Update SS', 'Reorder Point': 'Update ROP', 'Maximum Stock Level': 'Update MAX' }

// Maps a backend PolicyDriftItem into the Parameter Drift card shape the Replenishment
// page already renders (previously populated from a hardcoded mock array).
export function toDriftRow(item) {
  const driftingSinceDays = Math.max(0, Math.round((new Date(item.currentComputedAt) - new Date(item.previousComputedAt)) / 86400000))
  return {
    id: `PD-${item.skuCode}-${item.metric.replace(/\s+/g, '')}`,
    metric: item.metric,
    skuCode: item.skuCode,
    sku: item.skuName,
    node: item.node,
    erpValue: Math.round(item.previousValue),
    platformValue: Math.round(item.currentValue),
    driftPct: item.driftPct,
    driftDirection: item.driftDirection,
    driftingSinceDays,
    evidence: item.evidence.map(e => ({ label: e.label, from: e.fromValue, to: e.toValue, note: '' })),
    explanation: item.explanation,
    impact: item.impact,
    actionLabel: DRIFT_ACTION_LABEL[item.metric] || 'Update',
    source: 'api',
  }
}

export function toTransferInsightRow(candidate) {
  return {
    id: `XFER-${candidate.batch}-${candidate.fromBin}-${candidate.toBin}`,
    type: 'Transfer Recommendation',
    priority: 'Medium',
    severity: 'Medium',
    sku: candidate.batch,
    impact: `${candidate.suggestedQty.toLocaleString()} units of ${candidate.skuCode} at risk of write-off at ${candidate.fromNode}`,
    message: `${candidate.skuName} batch ${candidate.batch} in ${candidate.fromBin} (${candidate.fromZone}) ${candidate.reason}`,
    recommendation: `Move ${candidate.suggestedQty.toLocaleString()} units from ${candidate.fromBin} to the active pick face ${candidate.toBin} (${candidate.toZone}).`,
    status: 'Open',
    category: 'Balance',
    assignedTo: 'Unassigned',
    createdAt: '',
    source: 'api',
  }
}
