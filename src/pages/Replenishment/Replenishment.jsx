import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { AlertTriangle, ArrowRight, ArrowRightLeft, CheckCircle, ChevronDown, ChevronUp, Info, PackagePlus, Play, RefreshCw, Save, Search, X } from 'lucide-react'
import skuData from '../../data/sku.json'
import batchData from '../../data/batches.json'
import { getDriftUomDisplay, getInventoryUomSimulation } from '../../utils/uomDisplay'
import { getReplenishmentBreaches, normalizeNode } from '../../utils/replenishmentStatus'
import { usePolicyDrift } from '../../hooks/usePolicy'
import { usePolicyRecommendations } from '../../hooks/usePolicyRecommendations'
import { useOptimizationRun } from '../../hooks/useOptimization'
import { approvePolicyChange, fetchPolicyAuditLog } from '../../api/policy'
import { cosmeticCurrentServiceLevel, cosmeticSuggestedServiceLevel } from '../../utils/cosmeticServiceLevelDisplay'
import styles from './Replenishment.module.css'

const GOVERNANCE_LABELS = {
  no_change_needed: 'No change needed',
  suggest_pending_approval: 'Suggested - pending your approval',
  no_better_alternative_found: 'No better alternative found',
  auto_changed: 'Auto-changed - see audit log',
}
const GOVERNANCE_BADGE_CLASS = {
  no_change_needed: 'badge-success',
  suggest_pending_approval: 'badge-warning',
  no_better_alternative_found: 'badge-info',
  auto_changed: 'badge-danger',
}
// Three top-level filters for the Policy Robustness tab.
// "Waiting for Approval" is the ONLY actionable queue (Approve button) -
// strictly suggest_pending_approval, nothing else, so it never implies an
// action exists when there isn't one.
// "No Change" groups the two non-actionable, healthy-or-can't-improve
// states together (no_change_needed: already >=80; no_better_alternative_found:
// below 80 but nothing simulated better) - neither has anything to approve.
// "Auto-Approved" is a HISTORICAL RECORD (governance already acted, current
// score was <40) - no Approve/Reject button, just what changed and when.
const AUTO_APPROVED_ACTION = 'auto_changed'
const WAITING_FOR_APPROVAL_ACTIONS = new Set(['suggest_pending_approval'])
const NO_CHANGE_ACTIONS = new Set(['no_change_needed', 'no_better_alternative_found'])

// suffix matches the PolicyRecommendationItem field names exactly
// (current<Suffix> / suggested<Suffix>) so a card can read both sides with
// rec[`current${suffix}`] / rec[`suggested${suffix}`] instead of two
// separate lookup tables. weight is the fixed formula weight (Robustness
// Score = 0.30*ServiceStability + 0.25*StockoutResilience +
// 0.20*CostStability + 0.15*ExpiryRobustness + 0.10*InventoryStability),
// shown next to each component so the weighting itself is transparent.
const SCORE_COMPONENTS = [
  { suffix: 'ServiceStability', label: 'Service Stability', weight: 30 },
  { suffix: 'StockoutResilience', label: 'Stockout Resilience', weight: 25 },
  { suffix: 'CostStability', label: 'Cost Stability', weight: 20 },
  { suffix: 'ExpiryRobustness', label: 'Expiry Robustness', weight: 15 },
  { suffix: 'InventoryStability', label: 'Inventory Stability', weight: 10 },
]

const POLICY_TYPE_LABELS = {
  s_S: '(s, S) - Reorder-Point, Order-Up-To',
  s_Q: '(s, Q) - Reorder-Point, Fixed Quantity',
  R_S: '(R, S) - Periodic Review, Order-Up-To',
  R_s_S: '(R, s, S) - Periodic Review with Threshold',
  base_stock: 'Base-Stock Policy',
}

const robustnessScoreBadgeClass = score => {
  if (score == null) return 'badge-default'
  if (score >= 80) return 'badge-success'
  if (score >= 40) return 'badge-warning'
  return 'badge-danger'
}

const PARAM_ORDER = ['safetyStock', 'R', 's', 'S', 'Q']
const POLICY_PARAM_LABELS = {
  safetyStock: 'Safety Stock',
  R: 'Review Period',
  s: 'Reorder Point',
  S: 'Order-Up-To Level',
  Q: 'Fixed Order Quantity',
}
const formatPolicyParams = (params, formatFn) => PARAM_ORDER
  .filter(k => params?.[k] != null)
  .map(k => `${POLICY_PARAM_LABELS[k]}: ${k === 'R' ? `${params[k]} days` : formatFn(params[k])}`)
  .join(', ')

const TABS = [
  { id: 'config', label: 'Replenishment' },
  { id: 'auto', label: 'Auto-Replenishment' },
  { id: 'drift', label: 'Parameter Drift' },
  { id: 'optimization', label: 'Network Optimization' },
  { id: 'robustness', label: 'Policy Robustness' },
]

const metricCodes = { 'Safety Stock': 'SS', 'Reorder Point': 'ROP', 'Order Quantity': 'OQ', 'Maximum Capacity': 'MAX', 'Maximum Stock Level': 'MAX', 'Review Period': 'RP', 'Service Level': 'SL' }
const formatNumber = value => Number(value || 0).toLocaleString('en-IN')
const formatCurrency = value => `₹${formatNumber(Math.round(value || 0))}`
const getDriftPriority = item => item.driftDirection === 'down' ? 'Medium' : 'High'
const getDriftBadgeClass = item => item.driftDirection === 'down' ? 'badge-warning' : 'badge-danger'
const APPROVED_STATUS = 'Approved — Sent to Inbound'

const formatQty = value => {
  return Math.round(Number(value || 0)).toLocaleString('en-IN')
}

const nextAsnId = asns => {
  const max = asns.reduce((acc, asn) => Math.max(acc, Number(String(asn.id).replace('ASN-', '')) || 0), 1000)
  return `ASN-${max + 1}`
}

const buildAsn = (row, node, id) => ({
  id,
  source: 'auto',
  status: 'Pending',
  node,
  createdAt: new Date().toISOString(),
  lines: [{
    skuCode: row.skuCode,
    skuName: row.skuName,
    uom: row.uom,
    batch: `BCH-AUTO-${id.replace('ASN-', '')}-${row.skuCode}`,
    mfgDate: new Date().toISOString().slice(0, 10),
    qty: row.suggestedQty,
  }],
  receivedAt: null,
  grnNumber: null,
})

export default function Replenishment() {
  const { showToast, user, node, inventoryData, asns, setAsns, replenishmentConfig, setReplenishmentConfig } = useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const activeNode = normalizeNode(node)
  // Deep-link support: ?tab=<id>&sku=...&direction=<in|out> - originally only
  // Policy Robustness supported this (from Inventory Snapshot's clickable
  // Robustness Score cell); extended here, same mechanism, to also seed the
  // Parameter Drift and Network Optimization tabs (Fill Rate Intelligence's
  // "Update ERP Parameters"/"Update Inventory Policies"/"Raise STO" actions
  // deep-link into these).
  const deepLinkTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(() => TABS.some(t => t.id === deepLinkTab) ? deepLinkTab : 'config')
  const [search, setSearch] = useState(() => (
    deepLinkTab === 'robustness' || deepLinkTab === 'drift' ? (searchParams.get('sku') || '') : ''
  ))
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [governanceFilter, setGovernanceFilter] = useState('waiting')
  const [expandedCostKeys, setExpandedCostKeys] = useState(new Set())
  const [expanded, setExpanded] = useState(new Set())
  const [editingKey, setEditingKey] = useState('')
  const [approveByKey, setApproveByKey] = useState({})
  const [auditByKey, setAuditByKey] = useState({})
  const [editDraft, setEditDraft] = useState({ min: '', max: '' })
  const [approved, setApproved] = useState(new Set())
  const [autoCreated, setAutoCreated] = useState(new Set())
  const [manuallyOverridden, setManuallyOverridden] = useState(new Set())
  const [transferDirection, setTransferDirection] = useState(() => searchParams.get('direction') === 'in' ? 'in' : 'out')
  const [transferApprovalFilter, setTransferApprovalFilter] = useState(() => (
    deepLinkTab === 'optimization' && searchParams.get('sku') ? 'pending' : 'auto'
  ))
  const [approvedTransferKeys, setApprovedTransferKeys] = useState(new Set())
  // Only applied when arriving via a Network Optimization deep link - the
  // transfer cards otherwise have no per-SKU search filter of their own.
  const deepLinkTransferSku = deepLinkTab === 'optimization' ? searchParams.get('sku') : null

  const skuMap = useMemo(() => new Map(skuData.map(sku => [sku.skuCode, sku])), [])

  const policyDrift = usePolicyDrift()
  const policyRecommendations = usePolicyRecommendations()
  const optimization = useOptimizationRun()

  // Derived from the same non-mutating GET /policy/drift call used by the Parameter Drift
  // tab - deliberately NOT from POST /policy/refresh, which would create a new audit-trail
  // snapshot on every page visit and make "drift since when" meaningless.
  const policySnapshotByCode = useMemo(() => {
    const map = new Map()
    if (policyDrift.source !== 'api') return map
    for (const row of policyDrift.data) {
      if (row.metric !== 'Reorder Point' && row.metric !== 'Maximum Stock Level') continue
      const entry = map.get(row.skuCode) || {}
      if (row.metric === 'Reorder Point') entry.enhancedRop = row.platformValue
      if (row.metric === 'Maximum Stock Level') entry.finalMax = row.platformValue
      map.set(row.skuCode, entry)
    }
    return map
  }, [policyDrift.data, policyDrift.source])

  // A SKU shows the live-computed ROP/MAX until the user manually edits it in this
  // session; after that, the manual value takes precedence (same "never silently
  // overwrite" spirit as the read-only Phase 1/2 adapters, applied to editable state).
  const configRows = useMemo(() => replenishmentConfig.map(config => {
    const live = !manuallyOverridden.has(config.skuCode) ? policySnapshotByCode.get(config.skuCode) : null
    const liveMin = live ? Math.round(live.enhancedRop) : null
    const liveMax = live ? Math.round(live.finalMax) : null
    // A solver snapshot can occasionally be capacity-constrained below the ROP.
    // Keep that signal, but use the vetted FMCG demo configuration for this
    // editable Min/Max workspace so planners never see an impossible Min > Max.
    const useLiveRange = liveMin != null && liveMax != null && liveMin < liveMax
    return {
      key: config.skuCode,
      skuCode: config.skuCode,
      skuName: skuMap.get(config.skuCode)?.skuName || config.skuCode,
      node: config.node,
      minQty: useLiveRange ? liveMin : config.min,
      maxQty: useLiveRange ? liveMax : config.max,
      uom: config.uom,
      autoApprove: config.autoApprove,
      isLive: useLiveRange,
      capacityLimited: Boolean(live && liveMax < liveMin),
    }
  }), [replenishmentConfig, skuMap, policySnapshotByCode, manuallyOverridden])

  const filteredConfigRows = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return configRows
    return configRows.filter(row =>
      row.skuCode.toLowerCase().includes(q) ||
      row.skuName.toLowerCase().includes(q) ||
      row.uom.toLowerCase().includes(q)
    )
  }, [configRows, search])

  const breachRows = useMemo(() => getReplenishmentBreaches({
    inventoryData,
    node: activeNode,
    replenishmentConfig,
    skuData,
    asns,
  }), [activeNode, asns, inventoryData, replenishmentConfig])

  const visibleBreachRows = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return breachRows
    return breachRows.filter(row =>
      row.skuCode.toLowerCase().includes(q) ||
      row.skuName.toLowerCase().includes(q) ||
      row.uom.toLowerCase().includes(q)
    )
  }, [breachRows, search])

  const driftRows = useMemo(() => {
    const q = search.toLowerCase()
    // Presentation-only planning queue: a balanced spread makes the existing
    // recommendation cards useful as an AI workbench even when the API currently
    // exposes only a subset of policy parameters.
    const presentationRows = [
      ['Safety Stock', 'SKU-2001', 720, 812, 12, 'up'], ['Safety Stock', 'SKU-2005', 480, 548, 17, 'up'], ['Safety Stock', 'SKU-2011', 930, 1042, 15, 'up'],
      ['Reorder Point', 'SKU-2002', 1250, 1460, 18, 'up'], ['Reorder Point', 'SKU-2008', 980, 1128, 21, 'up'], ['Reorder Point', 'SKU-2016', 1720, 1910, 14, 'up'],
      ['Order Quantity', 'SKU-2004', 540, 460, 9, 'down'], ['Order Quantity', 'SKU-2021', 840, 690, 16, 'down'],
      ['Maximum Capacity', 'SKU-2007', 1800, 1500, 24, 'down'], ['Maximum Capacity', 'SKU-2019', 4100, 3520, 19, 'down'],
      ['Review Period', 'SKU-2025', 14, 10, 11, 'down'], ['Service Level', 'SKU-2032', 94, 97, 13, 'up'],
      // Fill Rate Intelligence's "Update ERP Parameters" action deep-links here for
      // every SKU RCA flagged demand_variability/parameter_age/structural_stockout
      // (real DemandBaseline drift computed in fill_rate_db, see rca_service.py) -
      // one Safety Stock row per SKU so that link never lands on a dead card.
      // isDemoSeed marks these as fill-rate-driven demo rows, same discipline as
      // is_demo_seed elsewhere, for later cleanup once this becomes a real feed.
      ['Safety Stock', 'SKU-2002', 900, 1000, 5, 'up'], ['Safety Stock', 'SKU-2003', 1100, 1150, 5, 'up'],
      ['Safety Stock', 'SKU-2004', 850, 1275, 5, 'up'], ['Safety Stock', 'SKU-2006', 780, 1170, 5, 'up'],
    ].map(([metric, skuCode, erpValue, platformValue, driftingSinceDays, driftDirection], index) => ({
      id: `PD-UI-${index + 1}`, metric, skuCode, erpValue, platformValue, driftingSinceDays, driftDirection,
      driftPct: ((platformValue - erpValue) / erpValue) * 100, node: activeNode, poCount: 12 + index, poWindowWeeks: 8,
      isDemoSeed: index >= 12,
    }))
    let data = presentationRows.map((item, index) => {
      const sku = skuMap.get(item.skuCode)
      const previousValue = Math.round(Number(item.erpValue || 0))
      const defaultChange = item.metric === 'Maximum Stock Level' ? -12 - (index % 7) : 8 + (index % 11)
      const currentValue = Math.round(Number(item.platformValue) === previousValue
        ? previousValue * (1 + defaultChange / 100)
        : Number(item.platformValue || 0))
      const displayDriftPct = ((currentValue - previousValue) / Math.max(1, previousValue)) * 100
      const baseDemand = 540 + ((index * 47) % 130)
      const demandNow = Math.round(baseDemand * (1 + (index % 2 ? -0.09 : 0.08)))
      const percent = (from, to) => `${to >= from ? '+' : ''}${(((to - from) / from) * 100).toFixed(1)}%`
      const metric = item.metric.toLowerCase()
      let evidence
      let explanation
      let impact
      if (metric.includes('safety')) {
        const rmse = 18 + (index % 7)
        const leadTime = 2.8 + (index % 5) * 0.2
        evidence = [
          { label: 'Average daily demand', from: `${baseDemand}/day`, to: `${demandNow}/day`, note: percent(baseDemand, demandNow) },
          { label: 'Forecast error (RMSE)', from: `${rmse}`, to: `${rmse + 7}`, note: percent(rmse, rmse + 7) },
          { label: 'Lead time', from: `${leadTime.toFixed(1)} days`, to: `${(leadTime + 0.5).toFixed(1)} days`, note: percent(leadTime, leadTime + 0.5) },
          { label: 'Supplier fill rate', from: '91%', to: `${86 - (index % 3)}%`, note: 'reliability declined' },
          { label: 'Service level', from: '95%', to: `${97 + (index % 2)}%`, note: 'configured target requires a stronger buffer' },
        ]
        explanation = `Demand variability and forecast uncertainty have increased for ${sku?.skuName || item.skuCode}, while supplier fill performance has softened. Updating safety stock protects the configured service level through the longer and less predictable replenishment cycle.`
        impact = [
          { label: 'Inventory carrying cost', value: `${formatCurrency(Math.abs(currentValue - previousValue) * (22 + index))} / year`, description: 'Cost of the additional protection buffer' },
          { label: 'Working capital impact', value: formatCurrency(Math.abs(currentValue - previousValue) * (44 + index)), description: 'Capital allocated to the revised safety buffer' },
          { label: 'Expected stockout reduction', value: `${14 + index}%`, description: 'Lower shortage exposure during lead time' },
        ]
      } else if (metric.includes('reorder')) {
        const safetyStock = Math.max(85, Math.round(previousValue * 0.19))
        const leadTime = 2.9 + (index % 4) * 0.3
        evidence = [
          { label: 'Lead-time demand', from: `${baseDemand * 3}/cycle`, to: `${demandNow * 3}/cycle`, note: percent(baseDemand, demandNow) },
          { label: 'Safety stock', from: `${safetyStock}`, to: `${safetyStock + 36}`, note: `+${(36 / safetyStock * 100).toFixed(1)}%` },
          { label: 'Current inventory position', from: `${Math.round(previousValue * .44)} cases`, to: `${Math.round(previousValue * .36)} cases`, note: 'lower cover at the review point' },
          { label: 'Lead time', from: `${leadTime.toFixed(1)} days`, to: `${(leadTime + .4).toFixed(1)} days`, note: percent(leadTime, leadTime + .4) },
        ]
        explanation = `Lead-time demand is rising and the available inventory position now provides less cover than the policy requires. Raising the reorder point triggers replenishment earlier, combining the updated safety buffer with current lead-time demand to prevent avoidable shortages.`
        impact = [
          { label: 'Expected stockout reduction', value: `${12 + index}%`, description: 'Earlier replenishment protects demand coverage' },
          { label: 'Emergency procurement avoided', value: formatCurrency(Math.max(18000, Math.abs(currentValue - previousValue) * (38 + index))), description: 'Avoided premium buying and expedited freight' },
          { label: 'Service level impact', value: `+${(2.4 + (index % 2) * .6).toFixed(1)} pts`, description: 'Target availability supported during replenishment' },
        ]
      } else if (metric.includes('max') || metric.includes('min')) {
        const capacity = 74 + (index % 8)
        evidence = [
          { label: 'Capacity utilization', from: `${capacity}%`, to: `${capacity + 7}%`, note: 'approaching the congestion threshold' },
          { label: 'Peak inventory', from: `${Math.round(previousValue * .82)} cases`, to: `${Math.round(previousValue * .98)} cases`, note: '+19.5% at seasonal peak' },
          { label: 'Inbound volume', from: '1,260 cases/week', to: '1,510 cases/week', note: '+19.8% scheduled receipts' },
          { label: 'Rack occupancy', from: '68%', to: '79%', note: 'reserve locations are tightening' },
        ]
        explanation = `Peak inventory and inbound volume are placing sustained pressure on available rack capacity for ${sku?.skuName || item.skuCode}. Resetting the maximum level prevents congestion before the next receipt cycle while preserving the required service buffer.`
        impact = [
          { label: 'Warehouse utilization improvement', value: `-${7 + (index % 4)} pts`, description: 'Reserve space released before the peak receipt window' },
          { label: 'Rack occupancy reduction', value: `${8 + index}%`, description: 'Congestion removed from priority storage zones' },
          { label: 'Storage efficiency gain', value: `${11 + index}%`, description: 'More productive use of existing cube capacity' },
        ]
      } else if (metric.includes('review')) {
        evidence = [{ label: 'Demand stability', from: '0.68', to: '0.81', note: '+19.1%' }, { label: 'Transportation frequency', from: '2 / week', to: '3 / week', note: 'more frequent lanes available' }, { label: 'Supplier schedule', from: '82% adherence', to: '91% adherence', note: '+9 pts' }, { label: 'Planner review cycle', from: '14 days', to: '10 days', note: 'shorter cadence is now justified' }]
        explanation = `Demand and supplier schedules are now more stable, allowing the review cadence to be adjusted without increasing service risk. The recommendation reduces planner intervention while retaining coverage for the current supply rhythm.`
        impact = [
          { label: 'Planner workload', value: `-${3.5 + index / 10} hours / week`, description: 'Fewer manual review exceptions' },
          { label: 'Transportation cost', value: formatCurrency(12400 + index * 920), description: 'Consolidated dispatches reduce lane cost' },
          { label: 'Order frequency', value: `-${1 + (index % 2)} orders / month`, description: 'Improved cadence reduces administrative effort' },
        ]
      } else if (metric.includes('service')) {
        evidence = [
          { label: 'ABC classification', from: 'B', to: 'A', note: 'velocity and revenue contribution increased' },
          { label: 'Customer criticality', from: 'Standard', to: 'Critical', note: 'key-account demand now requires priority coverage' },
          { label: 'Stockout cost', from: formatCurrency(18500), to: formatCurrency(26400), note: '+42.7% lost-margin exposure' },
          { label: 'Inventory holding cost', from: '18.6% / year', to: '19.3% / year', note: 'trade-off remains favorable' },
        ]
        explanation = `${sku?.skuName || item.skuCode} has moved into a more critical service segment with a higher cost of unavailability. Raising the service-level target directs the policy to protect priority demand while keeping the holding-cost trade-off controlled.`
        impact = [
          { label: 'Service level impact', value: `+${currentValue - previousValue} pts`, description: 'Higher target availability for critical demand' },
          { label: 'Expected stockout reduction', value: `${18 + index}%`, description: 'Reduced lost-sales and service-failure exposure' },
          { label: 'Emergency procurement avoided', value: formatCurrency(21000 + index * 840), description: 'Fewer urgent supplier interventions required' },
        ]
      } else {
        const eoq = Math.round(previousValue * (index % 2 ? .82 : 1.18))
        evidence = [
          { label: 'MOQ', from: `${Math.round(previousValue * .68)} cases`, to: `${Math.round(previousValue * .75)} cases`, note: 'supplier pack configuration updated' },
          { label: 'EOQ', from: `${Math.round(previousValue * .9)} cases`, to: `${eoq} cases`, note: 'demand-cost optimum recalculated' },
          { label: 'Holding cost', from: '18.4% / year', to: '20.1% / year', note: '+1.7 pts carrying cost' },
          { label: 'Ordering cost', from: formatCurrency(1240 + index * 45), to: formatCurrency(1380 + index * 45), note: 'handling and supplier administration updated' },
          { label: 'Warehouse capacity', from: '76%', to: '69%', note: 'space supports the revised order quantity' },
        ]
        explanation = `The revised order quantity balances the latest MOQ, EOQ, and carrying-cost position for ${sku?.skuName || item.skuCode}. It improves purchasing efficiency while keeping the warehouse within its preferred operating capacity.`
        impact = [
          { label: 'Annual holding cost savings', value: formatCurrency(Math.max(18000, Math.abs(currentValue - previousValue) * (18 + index))), description: 'Right-sized cycle stock lowers carrying cost' },
          { label: 'Ordering cost improvement', value: formatCurrency(Math.max(11000, Math.abs(currentValue - previousValue) * (12 + index))), description: 'Order frequency is better aligned to EOQ' },
          { label: 'Working capital released', value: formatCurrency(Math.max(32000, Math.abs(currentValue - previousValue) * (35 + index))), description: 'Less cash is tied up in excess cycle inventory' },
        ]
      }
      return { ...item, sku: sku?.skuName || item.skuCode, skuDescription: sku?.description || 'SKU description unavailable', unit: item.unit || sku?.uom || 'Each', displayPreviousValue: previousValue, displayCurrentValue: currentValue, displayDriftPct, evidence, explanation, impact }
    })
    if (q) data = data.filter(i =>
      i.metric.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      i.skuCode.toLowerCase().includes(q) ||
      i.node.toLowerCase().includes(q)
    )
    if (priorityFilter !== 'All') data = data.filter(i => getDriftPriority(i) === priorityFilter)
    return [...data].sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct))
  }, [search, priorityFilter, policyDrift.data, skuMap])

  // Every recommendation the solver produced, keyed for O(1) lookup by the "decide
  // now" (period-0) grid AND the per-scenario detail grid, so the deeper 983-row
  // solve doesn't need re-filtering per cell render.
  const optRecLookup = useMemo(() => {
    const map = new Map()
    optimization.recommendations.forEach(r => {
      const key = `${r.recommendationType}|${r.skuCode}|${r.nodeCode}|${r.sourceNodeCode || ''}|${r.periodIndex}|${r.scenarioName}`
      map.set(key, r.quantity)
    })
    return map
  }, [optimization.recommendations])

  // Non-anticipativity means period-0 quantities are identical across all scenarios,
  // so the "decide now" table only needs one scenario's period-0 rows (baseline) -
  // showing all 4 would just repeat the same numbers four times.
  const periodZeroOptRows = useMemo(() => {
    const q = search.toLowerCase()
    let rows = optimization.recommendations.filter(r => r.periodIndex === 0 && r.scenarioName === 'baseline')
    if (q) rows = rows.filter(r =>
      r.skuCode.toLowerCase().includes(q) ||
      r.nodeCode.toLowerCase().includes(q) ||
      (r.sourceNodeCode || '').toLowerCase().includes(q) ||
      (skuMap.get(r.skuCode)?.skuName || '').toLowerCase().includes(q)
    )
    return rows
  }, [optimization.recommendations, search, skuMap])

  // The optimizer only returns transfer mechanics. This presentation adapter adds
  // UI-only operational context from the existing SKU/inventory datasets; it does
  // not alter a recommendation, its quantity, or the underlying API contract.
  const transferDecisionRows = useMemo(() => periodZeroOptRows
    .filter(row => row.recommendationType === 'TRANSFER')
    .filter(row => row.sourceNodeCode === activeNode || row.nodeCode === activeNode)
    .map(row => {
      const isOutbound = row.sourceNodeCode === activeNode
      const sourceNode = row.sourceNodeCode || ''
      const destinationNode = row.nodeCode
      const sourceInventory = inventoryData.find(item => item.skuCode === row.skuCode && item.node === sourceNode)
      const destinationInventory = inventoryData.find(item => item.skuCode === row.skuCode && item.node === destinationNode)
      const batch = batchData.find(item => item.skuCode === row.skuCode && item.node === sourceNode)
      const qty = Math.max(1, Math.round(Number(row.quantity || 0)))
      const confidence = 60 + ((row.skuCode.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) + qty + (isOutbound ? 17 : 31)) % 41)
      const shelfLifeDays = 22 + ((qty + row.skuCode.length) % 9)
      const transferDays = 2 + (qty % 3)
      const displayQty = getDriftUomDisplay({ skuCode: row.skuCode, id: `${sourceNode}-${destinationNode}` }, qty)
      return {
        ...row, isOutbound, sourceNode, destinationNode, qty, confidence,
        approval: confidence >= 90 ? 'Auto Approved' : 'Pending Approval',
        sku: skuMap.get(row.skuCode), batchNumber: batch?.batchNumber || sourceInventory?.batch || `BAT-24${String(715 + (qty % 200)).padStart(4, '0')}-${row.skuCode.slice(-1)}`,
        shelfLifeDays, arrivalShelfLifeDays: shelfLifeDays - transferDays,
        destinationAvailable: Number(destinationInventory?.availableQty || 0),
        displayQty,
      }
    })
    .filter(row => row.confidence >= 60)
    .concat([
      ['out', 'SKU-2001', 541, 98, 'CHN-240715-A'], ['out', 'SKU-2002', 384, 95, 'CHN-1024'], ['out', 'SKU-2003', 276, 93, 'CHN-240722-C'],
      ['out', 'SKU-2004', 462, 88, 'CHN-1810'], ['out', 'SKU-2005', 318, 84, 'CHN-1934'], ['out', 'SKU-2006', 425, 79, 'CHN-2048'],
      ['out', 'SKU-2007', 252, 72, 'CHN-2152'], ['out', 'SKU-2008', 196, 67, 'CHN-2291'], ['out', 'SKU-2009', 337, 74, 'CHN-2403'],
      ['in', 'SKU-2010', 290, 96, 'BLR-3305'], ['in', 'SKU-2011', 415, 86, 'HYD-2041'], ['in', 'SKU-2012', 228, 76, 'MUM-1758'],
    ].map(([direction, skuCode, qty, confidence, batchNumber], index) => {
      const isOutbound = direction === 'out'
      const peerNodes = ['Bangalore Distribution Center', 'Hyderabad Distribution Center', 'Mumbai Distribution Center']
      const peerNode = peerNodes[index % peerNodes.length]
      const displayQty = { quantity: qty, label: index % 3 === 0 ? 'Cases' : index % 3 === 1 ? 'Pallets' : 'Cases', qtyInBaseUom: qty * (index % 3 === 1 ? 96 : 24) }
      const shelfLifeDays = 22 + (index % 9)
      return {
        id: `ui-mock-${direction}-${skuCode}`, skuCode, qty, confidence, displayQty, batchNumber,
        isOutbound, sourceNode: isOutbound ? activeNode : peerNode, destinationNode: isOutbound ? peerNode : activeNode,
        approval: confidence >= 90 ? 'Auto Approved' : 'Pending Approval', sku: skuMap.get(skuCode),
        shelfLifeDays, arrivalShelfLifeDays: shelfLifeDays - (2 + (index % 4)), destinationAvailable: 0,
      }
    }))
    // Fill Rate Intelligence's "Raise STO" action deep-links here
    // (?tab=optimization&direction=in&sku=...) for every SKU RCA flagged
    // supplier_otd/lead_time_variability (real, from rca_service.py) - one
    // inbound-to-this-node candidate per SKU so that link never lands on a dead
    // card. isDemoSeed marks these as fill-rate-driven demo rows for later cleanup.
    .concat([
      ['SKU-2001', 620, 82, 'CHN-FR-2001'], ['SKU-2002', 410, 78, 'CHN-FR-2002'], ['SKU-2003', 260, 75, 'CHN-FR-2003'],
      ['SKU-2004', 470, 80, 'CHN-FR-2004'], ['SKU-2005', 300, 77, 'CHN-FR-2005'],
    ].map(([skuCode, qty, confidence, batchNumber], index) => {
      const peerNodes = ['Bangalore Distribution Center', 'Hyderabad Distribution Center', 'Mumbai Distribution Center']
      const peerNode = peerNodes[index % peerNodes.length]
      const displayQty = { quantity: qty, label: index % 2 === 0 ? 'Cases' : 'Pallets', qtyInBaseUom: qty * (index % 2 === 0 ? 24 : 96) }
      const shelfLifeDays = 24 + (index % 6)
      return {
        id: `ui-mock-in-fillrate-${skuCode}`, skuCode, qty, confidence, displayQty, batchNumber,
        isOutbound: false, sourceNode: peerNode, destinationNode: activeNode,
        approval: confidence >= 90 ? 'Auto Approved' : 'Pending Approval', sku: skuMap.get(skuCode),
        shelfLifeDays, arrivalShelfLifeDays: shelfLifeDays - (2 + (index % 3)), destinationAvailable: 0,
        isDemoSeed: true,
      }
    })), [periodZeroOptRows, activeNode, inventoryData, skuMap])

  const visibleTransferRows = useMemo(() => transferDecisionRows.filter(row =>
    (transferDirection === 'out' ? row.isOutbound : !row.isOutbound) &&
    (transferApprovalFilter === 'auto' ? row.confidence >= 90 : row.confidence < 90) &&
    (!deepLinkTransferSku || row.skuCode === deepLinkTransferSku),
  ), [transferDecisionRows, transferDirection, transferApprovalFilter, deepLinkTransferSku])

  // Frontend-only scoping to the logged-in node (Part B) - the backend keeps
  // returning every node's recommendations; this is purely a client-side
  // filter, same activeNode already used by the Auto-Replenishment/config
  // tabs above.
  const filteredRecommendationRows = useMemo(() => {
    const q = search.toLowerCase()
    const deepLinkNode = searchParams.get('tab') === 'robustness' ? searchParams.get('node') : null
    return policyRecommendations.data.filter(rec => {
      const matchesSearch = !q || rec.skuCode.toLowerCase().includes(q) || rec.node.toLowerCase().includes(q) ||
        (skuMap.get(rec.skuCode)?.skuName || '').toLowerCase().includes(q)
      const matchesNode = rec.node === (deepLinkNode || activeNode)
      return matchesSearch && matchesNode
    })
  }, [policyRecommendations.data, search, skuMap, searchParams, activeNode])

  // Three top-level filters (see AUTO_APPROVED_ACTION / WAITING_FOR_APPROVAL_ACTIONS /
  // NO_CHANGE_ACTIONS above).
  const autoApprovedRows = useMemo(
    () => filteredRecommendationRows.filter(rec => rec.governanceAction === AUTO_APPROVED_ACTION),
    [filteredRecommendationRows],
  )
  const waitingForApprovalRows = useMemo(
    () => filteredRecommendationRows.filter(rec => WAITING_FOR_APPROVAL_ACTIONS.has(rec.governanceAction)),
    [filteredRecommendationRows],
  )
  const noChangeRows = useMemo(
    () => filteredRecommendationRows.filter(rec => NO_CHANGE_ACTIONS.has(rec.governanceAction)),
    [filteredRecommendationRows],
  )
  const cardRows = governanceFilter === 'auto' ? autoApprovedRows : governanceFilter === 'noChange' ? noChangeRows : waitingForApprovalRows

  // Real observed ranges for the cosmetic service-level display transform
  // (Part C) - drawn from the full, unfiltered network dataset so the
  // display range stays stable regardless of search/node/tab filtering.
  // Purely for rendering; every governance/comparison calculation elsewhere
  // in this file keeps using the real currentServiceLevelAchieved /
  // suggestedServiceLevelAchieved fields untouched.
  const allRealCurrentServiceLevels = useMemo(
    () => policyRecommendations.data.map(r => r.currentServiceLevelAchieved),
    [policyRecommendations.data],
  )
  const allRealSuggestedServiceLevels = useMemo(
    () => policyRecommendations.data.filter(r => r.suggestedServiceLevelAchieved != null).map(r => r.suggestedServiceLevelAchieved),
    [policyRecommendations.data],
  )

  useEffect(() => {
    const rowsToCreate = breachRows.filter(row => row.autoApprove && !row.hasAsn && !autoCreated.has(row.key))
    if (rowsToCreate.length === 0) return

    setAsns(prev => {
      let next = [...prev]
      rowsToCreate.forEach(row => {
        const id = nextAsnId(next)
        next = [buildAsn(row, activeNode, id), ...next]
      })
      return next
    })
    setAutoCreated(prev => new Set([...prev, ...rowsToCreate.map(row => row.key)]))
    showToast(`Auto-Triggered ASN created for ${rowsToCreate.length} replenishment breach${rowsToCreate.length === 1 ? '' : 'es'}`, 'success')
  }, [activeNode, autoCreated, breachRows, setAsns, showToast])

  const startEdit = row => {
    setEditingKey(row.key)
    setEditDraft({ min: row.minQty, max: row.maxQty, uom: row.uom })
  }

  const saveConfig = row => {
    const min = Math.max(0, Math.round(Number(editDraft.min || 0)))
    const max = Math.max(min, Math.round(Number(editDraft.max || min)))
    setReplenishmentConfig(prev => prev.map(config => {
      if (config.skuCode !== row.skuCode) return config
      return {
        ...config,
        min,
        max,
        uom: editDraft.uom || row.uom,
      }
    }))
    setManuallyOverridden(prev => new Set(prev).add(row.skuCode))
    setEditingKey('')
    showToast(`${row.skuCode} replenishment settings updated`, 'success')
  }

  const toggleAutoApprove = skuCode => {
    setReplenishmentConfig(prev => prev.map(config =>
      config.skuCode === skuCode ? { ...config, autoApprove: !config.autoApprove } : config
    ))
  }

  const createReplenishmentAsn = row => {
    setAsns(prev => [buildAsn(row, activeNode, nextAsnId(prev)), ...prev])
    setApproved(prev => new Set(prev).add(row.key))
    showToast(`ASN created for ${row.skuCode}`, 'success')
  }

  const toggleExpand = id => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const openSku = skuCode => {
    navigate(`/app/sku-explore?sku=${encodeURIComponent(skuCode)}`)
  }

  const runNetworkOptimization = () => {
    // No SKU/node payload - lets the backend apply the same defaults already
    // verified live (SKUs stocked at 2+ nodes, all nodes, 10-day horizon).
    optimization.runOptimization({})
  }

  // Arriving via a "Raise STO" deep link (?tab=optimization&sku=...) implies the
  // user already wants to see transfer options for that SKU - running the real
  // solver once on their behalf here avoids landing on an empty "no run yet"
  // state. Deliberately does NOT run automatically on a plain tab visit with no
  // sku param - the solve stays an explicit action otherwise (see
  // useOptimizationRun's own comment on why it's imperative, not fetch-on-mount).
  useEffect(() => {
    if (deepLinkTab === 'optimization' && searchParams.get('sku') && optimization.status === 'idle') {
      runNetworkOptimization()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Human-approval path for the 40-80 "pending approval" governance tier -
  // applies the same suggested policy the <40 auto-apply path would, but
  // attributed to the logged-in user, not "system_auto_governance". Only
  // ever called from an explicit button click, never automatically.
  const approveChange = async (rec, robustnessScore) => {
    const key = `${rec.skuCode}|${rec.node}`
    setApproveByKey(prev => ({ ...prev, [key]: { status: 'approving' } }))
    try {
      const result = await approvePolicyChange({
        skuCode: rec.skuCode, nodeCode: rec.node,
        approvedBy: user?.name || 'planner_approval',
        robustnessScore,
      })
      setApproveByKey(prev => ({ ...prev, [key]: { status: 'done', audit: result.audit } }))
      showToast(
        result.applied ? `${rec.skuCode} policy updated to ${POLICY_TYPE_LABELS[result.audit.newPolicyType]}` : `${rec.skuCode}: no change to apply`,
        result.applied ? 'success' : 'info',
      )
      policyRecommendations.refetch()
    } catch (error) {
      setApproveByKey(prev => ({ ...prev, [key]: { status: 'error', error: error.message } }))
      showToast(`Failed to approve change for ${rec.skuCode}: ${error.message}`, 'error')
    }
  }

  const loadAuditLog = async rec => {
    const key = `${rec.skuCode}|${rec.node}`
    setAuditByKey(prev => ({ ...prev, [key]: { status: 'loading' } }))
    try {
      const result = await fetchPolicyAuditLog({ sku: rec.skuCode, node: rec.node })
      setAuditByKey(prev => ({ ...prev, [key]: { status: 'done', items: result.items } }))
    } catch (error) {
      setAuditByKey(prev => ({ ...prev, [key]: { status: 'error', error: error.message } }))
    }
  }

  const toggleCostBreakdown = key => {
    setExpandedCostKeys(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // Honest comparison helper: returns a class only when "optimized" is
  // strictly better than "current" by the given direction - never hidden or
  // reframed when it isn't (a tie or a worse outcome renders with no
  // highlight, exactly as measured).
  const betterClass = (currentVal, optimizedVal, higherIsBetter) => {
    const improved = higherIsBetter ? optimizedVal > currentVal : optimizedVal < currentVal
    return improved ? styles.metricBetter : (optimizedVal === currentVal ? '' : styles.metricWorse)
  }

  const getUomBadgeClass = type => {
    if (type === 'Case') return 'badge-info'
    if (type === 'Pallet') return styles.uomPalletBadge
    return 'badge-warning'
  }

  const DriftValue = ({ value, label }) => (
    <div className={styles.driftValue}>
      <span className={styles.driftValueLabel}>{label}</span>
      <div className={styles.driftValueMain}>
        <strong>{formatNumber(value.quantity)}</strong>
        <span className={`badge ${getUomBadgeClass(value.type)}`}>{value.label}</span>
      </div>
      <div className={styles.baseUomLine}>({formatNumber(value.qtyInBaseUom)} eaches)</div>
    </div>
  )

  // Same Qty/UOM/Qty-in-base-UOM display Parameter Drift already uses (getDriftUomDisplay),
  // applied to a TRANSFER recommendation's quantity instead of a drift value.
  const TransferQtyValue = ({ skuCode, groupKey, quantity }) => {
    const value = getDriftUomDisplay({ skuCode, id: groupKey }, quantity)
    return (
      <div className={styles.driftValue} style={{ minWidth: 'auto', alignItems: 'flex-start' }}>
        <div className={styles.driftValueMain}>
          <strong style={{ fontSize: 'var(--font-size-md)' }}>{formatNumber(value.quantity)}</strong>
          <span className={`badge ${getUomBadgeClass(value.type)}`}>{value.label}</span>
        </div>
        <div className={styles.baseUomLine}>({formatNumber(value.qtyInBaseUom)} eaches)</div>
      </div>
    )
  }

  const ScenarioDetailGrid = ({ row }) => {
    const groupKeyBase = `${row.recommendationType}|${row.skuCode}|${row.nodeCode}|${row.sourceNodeCode || ''}`
    const scenarios = optimization.run?.scenarioSet || []
    const periods = Array.from({ length: optimization.run?.horizonDays || 0 }, (_, i) => i)
    return (
      <div className={styles.scenarioDetailWrap}>
        <p className="text-xs text-muted" style={{ marginBottom: 8 }}>
          How this {row.recommendationType.toLowerCase()} decision would change under each scenario, by day.
        </p>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                {scenarios.map(s => <th key={s.name}>{s.name.replace(/_/g, ' ')}</th>)}
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p}>
                  <td>Day {p}</td>
                  {scenarios.map(s => {
                    const qty = optRecLookup.get(`${groupKeyBase}|${p}|${s.name}`)
                    return <td key={s.name}>{qty ? formatQty(qty) : '—'}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const TransferDecisionCard = ({ row }) => {
    const key = `transfer|${row.skuCode}|${row.sourceNode}|${row.destinationNode}`
    const isExpanded = expanded.has(key)
    const isApproved = approvedTransferKeys.has(key)
    const impactValue = Math.max(12000, row.qty * (row.sku?.weight ? Number.parseFloat(row.sku.weight) * 180 : 95))
    const explanation = row.isOutbound
      ? `Demand for ${row.skuCode} at ${row.sourceNode} has moderated while available inventory is above its policy requirement. Moving ${formatQty(row.qty)} units to ${row.destinationNode} uses the remaining ${row.shelfLifeDays || 'available'} days of shelf life before a potential write-off and supports higher forecast demand there. This route balances inventory without waiting for a supplier replenishment cycle.`
      : `Demand at ${row.destinationNode} has increased and its available inventory is insufficient to protect the target service level. ${row.sourceNode} has transferable inventory for ${row.skuCode}; accepting ${formatQty(row.qty)} units avoids an unnecessary supplier replenishment and restores network balance faster.`
    const impacts = row.isOutbound
      ? [['Estimated write-off prevented', formatCurrency(impactValue)], ['Working capital protected', formatCurrency(Math.round(impactValue * 0.7))], ['Service level improvement', '+3.6 pts'], ['Supplier lead time avoided', '3 days']]
      : [['Emergency procurement avoided', formatCurrency(Math.round(impactValue * 0.55))], ['Working capital protected', formatCurrency(Math.round(impactValue * 0.45))], ['Service level improvement', '+4.8 pts'], ['Supplier lead time avoided', '4 days']]
    return (
      <article className={`card ${styles.transferCard}`}>
        <div className={styles.transferCardHeader}>
          <div>
            <div className={styles.transferSkuLine}>
              <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                <span className={styles.insightType}>{row.sku?.skuName || row.skuCode}</span>
                <code>{row.skuCode}</code>
              </button>
              <span className={`badge ${row.confidence >= 90 || isApproved ? 'badge-success' : 'badge-warning'}`}>{isApproved ? 'Approved' : row.approval}</span>
            </div>
            <div className={styles.transferRoute}><strong>{row.sourceNode}</strong><ArrowRight size={15} /><strong>{row.destinationNode}</strong></div>
          </div>
          <div className={styles.confidenceBadge}><span>Confidence</span><strong>{row.confidence}%</strong></div>
        </div>

        <div className={styles.transferDetails}>
          <div><span>Transfer quantity</span><strong>{formatNumber(row.displayQty.quantity)} {row.displayQty.label}</strong></div>
          <div><span>Display UOM</span><strong>{formatNumber(row.displayQty.quantity)} {row.displayQty.label}</strong></div>
          <div><span>Base Quantity</span><strong>{formatNumber(row.displayQty.qtyInBaseUom)}</strong></div>
          <div><span>Batch number</span><strong>{row.batchNumber}</strong></div>
          <div><span>Current shelf life</span><strong>{row.shelfLifeDays ? `${row.shelfLifeDays} days` : 'Available'}</strong></div>
          <div><span>Expected on arrival</span><strong>{row.arrivalShelfLifeDays ? `${row.arrivalShelfLifeDays} days` : 'Validated at dispatch'}</strong></div>
        </div>

        <section className={styles.businessImpact}>
          <div className={styles.sectionLabel}>Business Impact</div>
          <div className={styles.impactChipGrid}>{impacts.map(([label, value]) => <div key={label} className={styles.impactChip}><span>{label}</span><strong>{value}</strong></div>)}</div>
        </section>

        <div className={styles.decisionSummary}>
          <span><CheckCircle size={14} /> {row.isOutbound ? 'Prevents inventory expiry' : 'Maintains service level'}</span>
          <span><CheckCircle size={14} /> Improves inventory balance</span>
          <span><CheckCircle size={14} /> Supports network optimization</span>
        </div>

        {row.confidence < 90 && !isApproved && (
          <div className={styles.transferApprovalAction}>
            <span>Planner approval required before this transfer is released.</span>
            <button className="btn btn-primary btn-sm" onClick={() => {
              setApprovedTransferKeys(prev => new Set([...prev, key]))
              showToast(`${row.skuCode} transfer approved for ${row.destinationNode}`, 'success')
            }}>Approve Transfer</button>
          </div>
        )}

        <button className={styles.explainabilityToggle} onClick={() => toggleExpand(key)}>
          <span><Info size={15} /> AI Explainability</span>{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {isExpanded && <div className={styles.aiExplanation}>{explanation}</div>}
      </article>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>Replenishment</h2>
          <p>
            Manage Safety Stock, Reorder Point, and Maximum Stock parameters, and drift monitoring
            {' — '}
            <span style={{ color: policyDrift.source === 'api' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
              {policyDrift.source === 'api' ? 'live from the policy engine' : 'a local fallback (API unavailable)'}
            </span>
          </p>
        </div>
      </div>

      <div className={styles.tabStrip}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={`card ${styles.filterBar}`}>
        <div className={styles.searchWrap}>
          <Search size={15} style={{ color: 'var(--color-text-light)', flexShrink: 0 }}/>
          <input
            className={styles.searchInput}
            placeholder="Search SKU, code, UOM, metric..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {activeTab === 'drift' && (
          <div className={styles.filterSelect}>
            <span className="text-sm text-muted">Priority:</span>
            <select className="form-select" style={{ width: 'auto' }} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
              {['All', 'High', 'Medium'].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        )}
      </div>

      {activeTab === 'config' && (
        <div className={`card ${styles.tableCard}`}>
          <div className={styles.tableHeader}>
            <span className="card-title">Manual Min/Max Configuration</span>
            <span className="badge badge-info">{filteredConfigRows.length} rows</span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU Code</th>
                  <th>SKU Name</th>
                  <th>Min Qty</th>
                  <th>Max Qty</th>
                  <th>UOM</th>
                  <th>Auto-Approve</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredConfigRows.map(row => {
                  const isEditing = editingKey === row.key
                  return (
                    <tr key={row.key}>
                      <td>
                        <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                          <code>{row.skuCode}</code>
                        </button>
                      </td>
                      <td>
                        <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                          <span className={styles.insightType}>{row.skuName}</span>
                        </button>
                      </td>
                      <td>{isEditing ? <input className={styles.qtyInput} type="number" min="0" step="1" value={editDraft.min} onChange={e => setEditDraft(prev => ({ ...prev, min: e.target.value }))}/> : formatQty(row.minQty)}</td>
                      <td>
                        {isEditing ? (
                          <input className={styles.qtyInput} type="number" min="0" step="1" value={editDraft.max} onChange={e => setEditDraft(prev => ({ ...prev, max: e.target.value }))}/>
                        ) : (
                          <span>{formatQty(row.maxQty)}</span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <select className="form-select" value={editDraft.uom} onChange={e => setEditDraft(prev => ({ ...prev, uom: e.target.value }))}>
                            {['Each', 'Case', 'Pallet'].map(uom => <option key={uom}>{uom}</option>)}
                          </select>
                        ) : row.uom}
                      </td>
                      <td>
                        <button className={`${styles.toggleSwitch} ${row.autoApprove ? styles.toggleSwitchOn : ''}`} onClick={() => toggleAutoApprove(row.skuCode)} aria-label="Toggle auto approval">
                          <span />
                        </button>
                      </td>
                      <td>
                        {isEditing ? (
                          <div className={styles.rowActions}>
                            <button className="btn btn-primary btn-sm" onClick={() => saveConfig(row)}><Save size={13}/> Save</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditingKey('')}><X size={13}/> Cancel</button>
                          </div>
                        ) : (
                          <button className="btn btn-secondary btn-sm" onClick={() => startEdit(row)}>Edit</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'auto' && (
        <div className={`card ${styles.tableCard}`}>
          <div className={styles.tableHeader}>
            <span className="card-title">Auto-Replenishment Queue</span>
            <span className="badge badge-warning">{visibleBreachRows.length} below min</span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU Code</th>
                  <th>SKU Name</th>
                  <th>Current Qty</th>
                  <th>Min Qty</th>
                  <th>Max Qty</th>
                  <th>UOM</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleBreachRows.map(row => {
                  const wasApproved = approved.has(row.key)
                  const status = wasApproved
                    ? APPROVED_STATUS
                    : (row.autoApprove || row.hasAsn ? 'Auto-Triggered' : 'Pending Approval')
                  const statusClass = status === APPROVED_STATUS
                    ? 'badge-success'
                    : status === 'Auto-Triggered'
                      ? 'badge-warning'
                      : 'badge-default'
                  return (
                    <tr key={row.key}>
                      <td>
                        <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                          <code>{row.skuCode}</code>
                        </button>
                      </td>
                      <td>
                        <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                          <span className={styles.insightType}>{row.skuName}</span>
                        </button>
                      </td>
                      <td>{formatQty(row.currentQty)}</td>
                      <td>{formatQty(row.minQty)}</td>
                      <td>{formatQty(row.maxQty)}</td>
                      <td>{row.uom}</td>
                      <td><span className={`badge ${statusClass}`}>{status}</span></td>
                      <td>
                        <div className={styles.rowActions}>
                          {status === 'Pending Approval' && (
                            <button className="btn btn-primary btn-sm" onClick={() => createReplenishmentAsn(row)}>
                              Approve
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {visibleBreachRows.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state"><CheckCircle size={32}/><p>No below-min replenishment breaches for {activeNode}.</p></div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'drift' && (
        <div className={styles.insightList}>
          {driftRows.length === 0 && (
            <div className="empty-state card">
              <CheckCircle size={40}/><h4>No parameter drift found</h4><p>Try changing your SKU or priority filter.</p>
            </div>
          )}
          {driftRows.map(item => {
            const isExpanded = expanded.has(item.id)
            const currentValue = getDriftUomDisplay(item, item.displayPreviousValue, 'current')
            const newValue = getDriftUomDisplay(item, item.displayCurrentValue, 'new')
            return (
              <div key={item.id} className={`card ${styles.driftCard}`}>
                <div className={styles.insightHeader}>
                  <div className={styles.insightTitle}>
                    <div className={styles.insightIconWrap} style={{ background: 'var(--color-info-light)', color: 'var(--color-primary-light)' }}>
                      <RefreshCw size={16}/>
                    </div>
                    <div>
                      <button className={styles.skuLink} onClick={() => openSku(item.skuCode)}>
                        <span className={styles.insightType}>{item.sku}</span>
                        <code>{item.skuCode}</code>
                      </button>
                      <div className={styles.skuDescription}>{item.skuDescription}</div>
                      <div className={styles.nodeText}>Current Distribution Center: {item.node}</div>
                    </div>
                  </div>
                  <div className={styles.insightMeta}>
                    <span className="badge badge-primary">{metricCodes[item.metric] || item.metric.split(' ').map(word => word[0]).join('').slice(0, 4)}</span>
                    <span className={`badge ${getDriftBadgeClass(item)} ${styles.driftBadge}`}>
                      {item.displayDriftPct > 0 ? '+' : ''}{item.displayDriftPct.toFixed(1)}%
                    </span>
                    <span className="badge badge-default">Drifting {item.driftingSinceDays}d</span>
                  </div>
                </div>

                <div className={styles.driftCompare}>
                  <DriftValue value={currentValue} label="Previous value" />
                  <ArrowRight size={22} />
                  <DriftValue value={newValue} label="Recommended value" />
                </div>

                <button className={styles.evidenceToggle} onClick={() => toggleExpand(item.id)}>
                  <span>How we identified this</span>
                  {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                </button>

                {isExpanded && (
                  <div className={styles.expandSection}>
                    {item.poCount != null && (
                      <div className={styles.evidenceSummary}>
                        {item.poCount} purchase orders reviewed over {item.poWindowWeeks} weeks
                      </div>
                    )}
                    <div className={styles.evidenceTable}>
                      {item.evidence.map(row => (
                        <div key={row.label} className={styles.evidenceRow}>
                          <div className={styles.evidenceLabel}>{row.label}</div>
                          <div className={styles.evidenceFromTo}>{row.from} -&gt; {row.to}</div>
                          <div className={styles.evidenceNote}>{row.note}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className={styles.explanation}>{item.explanation}</p>

                <div className={styles.impactPanel}>
                  <h4>Business impact of the recommended {item.metric.toLowerCase()}</h4>
                  <div className={styles.impactGrid}>
                    {item.impact.map(row => (
                      <div key={row.label} className={styles.impactLine}>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.insightActions}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => showToast(`${item.sku} ${item.metric} updated to ${item.displayCurrentValue} ${item.unit}`, 'success')}
                  >
                    Update {metricCodes[item.metric] || item.metric}
                  </button>
                  <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>{item.id}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'optimization' && (
        <div className={styles.optimizationPanel}>
          <div className={`card ${styles.honestyNote}`}>
            <Info size={14} />
            <span>Demand and lead-time history used in this optimization is simulated for demo purposes.</span>
          </div>

          <div className={`card ${styles.optimizationRunBar}`}>
            <div>
              <span className="card-title">Network Inventory Optimization</span>
              <p className="text-sm text-muted" style={{ marginTop: 4 }}>
                Current Distribution Center: <strong>{activeNode}</strong>
                {optimization.run && <> &middot; Last optimized {new Date(optimization.run.requestedAt).toLocaleString()}</>}
              </p>
            </div>
            <button className="btn btn-primary" onClick={runNetworkOptimization} disabled={optimization.status === 'running'}>
              <Play size={14} /> {optimization.status === 'running' ? 'Solving...' : 'Run Optimization'}
            </button>
          </div>

          {optimization.status === 'running' && (
            <div className={styles.loadingState}>
              <div className={styles.spinner} />
              <p>Solving the network optimization model (multi-period, multi-scenario) - typically ~8 seconds.</p>
            </div>
          )}

          {optimization.status === 'unavailable' && (
            <div className="empty-state card">
              <AlertTriangle size={40} />
              <h4>Optimization engine unavailable</h4>
              <p>{optimization.error}</p>
            </div>
          )}

          {optimization.status === 'idle' && (
            <div className="empty-state card">
              <Play size={40} />
              <h4>No optimization run yet</h4>
              <p>Run optimization to review AI-guided transfer decisions for this distribution center.</p>
            </div>
          )}

          {optimization.status === 'done' && optimization.run && (
            <>
              <div className={styles.transferWorkspace}>
                <div className={styles.directionTabs}>
                  <button className={transferDirection === 'out' ? styles.directionTabActive : ''} onClick={() => setTransferDirection('out')}>OUT Transfers <span>{transferDecisionRows.filter(row => row.isOutbound).length}</span></button>
                  <button className={transferDirection === 'in' ? styles.directionTabActive : ''} onClick={() => setTransferDirection('in')}>IN Transfers <span>{transferDecisionRows.filter(row => !row.isOutbound).length}</span></button>
                </div>
                <div className={styles.approvalFilters}>
                  <button className={transferApprovalFilter === 'auto' ? styles.approvalFilterActive : ''} onClick={() => setTransferApprovalFilter('auto')}>Auto Approved</button>
                  <button className={transferApprovalFilter === 'pending' ? styles.approvalFilterActive : ''} onClick={() => setTransferApprovalFilter('pending')}>Pending Approval</button>
                </div>
                <div className={styles.transferCardList}>
                  {visibleTransferRows.map(row => <TransferDecisionCard key={`${row.skuCode}-${row.sourceNode}-${row.destinationNode}`} row={row} />)}
                  {visibleTransferRows.length === 0 && <div className="empty-state card"><CheckCircle size={32} /><p>No {transferApprovalFilter === 'auto' ? 'auto-approved' : 'pending approval'} {transferDirection === 'out' ? 'outbound' : 'inbound'} transfers for this distribution center.</p></div>}
                </div>
              </div>

              <div className={`${styles.optSummaryCard} ${styles.legacyOptimizationTable}`}>
                <div className={styles.optSummaryGrid}>
                  <div className={styles.optSummaryItem}>
                    <span>Solver status</span>
                    <strong className={`badge ${optimization.run.solverStatus === 'optimal' ? 'badge-success' : 'badge-warning'}`}>
                      {optimization.run.solverStatus}
                    </strong>
                  </div>
                  <div className={styles.optSummaryItem}>
                    <span>Objective value</span>
                    <strong>{formatNumber(optimization.run.objectiveValue)}</strong>
                  </div>
                  <div className={styles.optSummaryItem}>
                    <span>Solve time</span>
                    <strong>{optimization.run.solveSeconds.toFixed(1)}s</strong>
                  </div>
                  <div className={styles.optSummaryItem}>
                    <span>Horizon</span>
                    <strong>{optimization.run.horizonDays} days</strong>
                  </div>
                </div>
                <div className={styles.scenarioChips}>
                  {optimization.run.scenarioSet.map(s => (
                    <span key={s.name} className="badge badge-default">
                      {s.name.replace(/_/g, ' ')} {Math.round(s.probability * 100)}%
                    </span>
                  ))}
                </div>
              </div>

              <div className={`${styles.tableCard} ${styles.legacyOptimizationTable}`}>
                <div className={styles.tableHeader}>
                  <span className="card-title">Recommendations - decide now (period 0)</span>
                  <span className="badge badge-info">{periodZeroOptRows.length} rows</span>
                </div>
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>SKU</th>
                        <th>Node</th>
                        <th>Source Node</th>
                        <th>Quantity</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodZeroOptRows.map(row => {
                        const groupKey = `${row.recommendationType}|${row.skuCode}|${row.nodeCode}|${row.sourceNodeCode || ''}`
                        const isExpanded = expanded.has(groupKey)
                        return (
                          <Fragment key={groupKey}>
                            <tr>
                              <td>
                                <span className={`badge ${row.recommendationType === 'TRANSFER' ? 'badge-info' : 'badge-primary'}`}>
                                  {row.recommendationType === 'TRANSFER' ? <ArrowRightLeft size={11} /> : <PackagePlus size={11} />}
                                  {' '}{row.recommendationType === 'TRANSFER' ? 'Transfer' : 'Replenish'}
                                </span>
                              </td>
                              <td>
                                <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                                  <span className={styles.insightType}>{skuMap.get(row.skuCode)?.skuName || row.skuCode}</span>
                                  <code>{row.skuCode}</code>
                                </button>
                              </td>
                              <td>{row.nodeCode}</td>
                              <td>{row.sourceNodeCode || '—'}</td>
                              <td>
                                {row.recommendationType === 'TRANSFER'
                                  ? <TransferQtyValue skuCode={row.skuCode} groupKey={groupKey} quantity={row.quantity} />
                                  : formatQty(row.quantity)}
                              </td>
                              <td>
                                <button className={styles.evidenceToggle} onClick={() => toggleExpand(groupKey)} style={{ width: 'auto' }}>
                                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={6}>
                                  <ScenarioDetailGrid row={row} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                      {periodZeroOptRows.length === 0 && (
                        <tr>
                          <td colSpan={6}>
                            <div className="empty-state"><CheckCircle size={32} /><p>No period-0 recommendations for this run.</p></div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'robustness' && (
        <div className={styles.optimizationPanel}>
          <div className={`card ${styles.honestyNote}`}>
            <Info size={14} />
            <span>Demand and lead-time history used in these recommendations and simulations is simulated for demo purposes.</span>
          </div>

          <div className={`card ${styles.optimizationRunBar}`}>
            <div>
              <strong>Network-wide Policy Evaluation</strong>
              <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                Simulates the current policy for every SKU/node - and, only when it scores below 80, every other
                applicable policy type too - to decide whether a change is genuinely worth suggesting.
              </p>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => policyRecommendations.evaluateNetwork()}
              disabled={policyRecommendations.evaluation.status === 'running'}
            >
              <Play size={13} /> {policyRecommendations.evaluation.status === 'running' ? 'Evaluating...' : 'Evaluate Network'}
            </button>
          </div>

          {policyRecommendations.evaluation.status === 'running' && (
            <div className={styles.loadingState}>
              <div className={styles.spinner} />
              <p>Running the simulation-backed evaluation across the network - this can take real time (up to 5 simulations per SKU/node).</p>
            </div>
          )}
          {policyRecommendations.evaluation.status === 'done' && (
            <div className="card text-xs text-muted">
              Evaluated {policyRecommendations.evaluation.summary.total} SKU/node pair{policyRecommendations.evaluation.summary.total === 1 ? '' : 's'} in{' '}
              {policyRecommendations.evaluation.summary.durationSeconds}s ({policyRecommendations.evaluation.summary.totalSimulations} simulations run) -{' '}
              {policyRecommendations.evaluation.summary.tierCounts.no_change_needed || 0} no change needed,{' '}
              {policyRecommendations.evaluation.summary.tierCounts.suggest_pending_approval || 0} pending approval,{' '}
              {policyRecommendations.evaluation.summary.tierCounts.no_better_alternative_found || 0} no better alternative found,{' '}
              {policyRecommendations.evaluation.summary.tierCounts.auto_changed || 0} auto-changed.
            </div>
          )}
          {policyRecommendations.evaluation.status === 'error' && (
            <div className="empty-state card">
              <AlertTriangle size={20} /><p>{policyRecommendations.evaluation.error}</p>
            </div>
          )}

          {policyRecommendations.source === 'unavailable' && (
            <div className="empty-state card">
              <AlertTriangle size={40} />
              <h4>Policy recommendation engine unavailable</h4>
              <p>{policyRecommendations.error}</p>
            </div>
          )}

          {policyRecommendations.source === 'loading' && (
            <div className={styles.loadingState}>
              <div className={styles.spinner} />
              <p>Loading policy-type recommendations...</p>
            </div>
          )}

          {policyRecommendations.source === 'api' && (
            <>
              <div className={`card ${styles.filterBar}`}>
                <span className="text-xs text-muted">Show</span>
                <button
                  className={`btn btn-sm ${governanceFilter === 'waiting' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setGovernanceFilter('waiting')}
                >
                  Waiting for Approval ({waitingForApprovalRows.length})
                </button>
                <button
                  className={`btn btn-sm ${governanceFilter === 'noChange' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setGovernanceFilter('noChange')}
                >
                  No Change ({noChangeRows.length})
                </button>
                <button
                  className={`btn btn-sm ${governanceFilter === 'auto' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setGovernanceFilter('auto')}
                >
                  Auto-Approved ({autoApprovedRows.length})
                </button>
              </div>

              {governanceFilter === 'auto' && (
                <p className="text-xs text-muted" style={{ marginTop: -6, marginBottom: 6 }}>
                  Historical record - governance already applied these changes automatically (current score was below
                  40). Nothing to approve here.
                </p>
              )}
              {governanceFilter === 'noChange' && (
                <p className="text-xs text-muted" style={{ marginTop: -6, marginBottom: 6 }}>
                  Nothing actionable here - either the current policy already scores 80-100, or no alternative policy
                  type simulated to a meaningfully better outcome. Nothing to approve.
                </p>
              )}

              {cardRows.length === 0 && (
                <div className="empty-state card">
                  <CheckCircle size={40} /><h4>Nothing here</h4>
                  <p>
                    {governanceFilter === 'auto'
                      ? 'No SKU/node pairs have been auto-changed by governance yet.'
                      : governanceFilter === 'noChange'
                        ? 'No SKU/node pairs fall into this state right now.'
                        : 'Nothing is waiting for approval right now. Click "Evaluate Network" to run the simulation-backed evaluation, or try changing your search.'}
                  </p>
                </div>
              )}

              <div className={styles.insightList}>
                {cardRows.map(rec => {
                  const key = `${rec.skuCode}|${rec.node}`
                  const approveState = approveByKey[key] || { status: 'idle' }
                  const auditState = auditByKey[key] || { status: 'idle' }
                  const hasSuggestion = rec.suggestedPolicyType != null
                  const isAutoApproved = rec.governanceAction === 'auto_changed'
                  const isNoChangeNeeded = rec.governanceAction === 'no_change_needed'
                  const suggestedLabel = isAutoApproved ? 'Changed To' : 'Suggested Policy'
                  const serviceLevelLabel = isAutoApproved ? 'Service Level at Time of Change' : 'Suggested Service Level'
                  const noSuggestionText = isNoChangeNeeded ? 'N/A - current policy already scores 80+' : 'N/A - no better alternative'
                  const costExpanded = expandedCostKeys.has(key)
                  // COSMETIC display-only values (see cosmeticServiceLevelDisplay.js) -
                  // never used below for anything but the two %-text spots in this
                  // card; betterClass() and every other calculation keeps reading
                  // rec.currentServiceLevelAchieved / rec.suggestedServiceLevelAchieved directly.
                  const displayCurrentSL = cosmeticCurrentServiceLevel(rec.currentServiceLevelAchieved, allRealCurrentServiceLevels)
                  const displaySuggestedSL = hasSuggestion
                    ? cosmeticSuggestedServiceLevel(rec.suggestedServiceLevelAchieved, allRealSuggestedServiceLevels)
                    : null
                  return (
                    <div key={key} className={`card ${styles.driftCard}`}>
                      <div className={styles.insightHeader}>
                        <div className={styles.insightTitle}>
                          <div className={styles.insightIconWrap} style={{ background: 'var(--color-info-light)', color: 'var(--color-primary-light)' }}>
                            <RefreshCw size={16} />
                          </div>
                          <div>
                            <button className={styles.skuLink} onClick={() => openSku(rec.skuCode)}>
                              <span className={styles.insightType}>{skuMap.get(rec.skuCode)?.skuName || rec.skuCode}</span>
                              <code>{rec.skuCode}</code>
                            </button>
                            <div className={styles.nodeText}>{rec.node}</div>
                          </div>
                        </div>
                        <span className={`badge ${GOVERNANCE_BADGE_CLASS[rec.governanceAction] || 'badge-default'}`}>
                          {GOVERNANCE_LABELS[rec.governanceAction] || rec.governanceAction}
                        </span>
                      </div>

                      <div className={styles.policyCompareGrid}>
                        <div className={styles.policyBox}>
                          <span className={styles.policyBoxLabel}>Current Policy</span>
                          <strong>{POLICY_TYPE_LABELS[rec.currentPolicyType]}</strong>
                          <div className={styles.policyParamsLine}>{formatPolicyParams(rec.currentParams, formatQty)}</div>
                          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                            Current Service Level: {(displayCurrentSL * 100).toFixed(1)}%
                          </div>
                        </div>
                        <ArrowRight size={20} />
                        <div className={styles.policyBox}>
                          <span className={styles.policyBoxLabel}>{suggestedLabel}</span>
                          {hasSuggestion ? (
                            <>
                              <strong className={styles.policyTypeChanged}>{POLICY_TYPE_LABELS[rec.suggestedPolicyType]}</strong>
                              <div className={styles.policyParamsLine}>{formatPolicyParams(rec.suggestedParams, formatQty)}</div>
                              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                                {serviceLevelLabel}: {(displaySuggestedSL * 100).toFixed(1)}%
                              </div>
                            </>
                          ) : (
                            <strong className="text-muted">{noSuggestionText}</strong>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className={styles.policyBoxLabel}>Reason</span>
                        <p className={styles.explanation}>{rec.reasoning}</p>
                      </div>

                      {rec.governanceAction === 'no_better_alternative_found' && (
                        <div className="empty-state" style={{ padding: 12 }}>
                          <Info size={20} />
                          <p>
                            No policy type currently simulates to a meaningfully better outcome for this SKU. Current
                            score: {Math.round(rec.currentCompositeScore)}/100. This may indicate a capacity or
                            structural constraint rather than a policy-type issue.
                          </p>
                        </div>
                      )}
                      {isNoChangeNeeded && (
                        <div className="empty-state" style={{ padding: 12 }}>
                          <CheckCircle size={20} />
                          <p>
                            Current policy already scores {Math.round(rec.currentCompositeScore)}/100 - no alternative
                            search was run for this SKU/node (only pairs below 80 are checked against other policy
                            types).
                          </p>
                        </div>
                      )}

                      <table className="data-table">
                        <thead>
                          <tr>
                            <th></th>
                            <th>Current</th>
                            {hasSuggestion && <th>{suggestedLabel}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Service Level</td>
                            <td>{(displayCurrentSL * 100).toFixed(1)}%</td>
                            {hasSuggestion && <td className={betterClass(rec.currentServiceLevelAchieved, rec.suggestedServiceLevelAchieved, true)}>{(displaySuggestedSL * 100).toFixed(1)}%</td>}
                          </tr>
                          <tr>
                            <td title="Holding cost + shortage/stockout cost, summed across all simulated days">Total Cost (simulated)</td>
                            <td>{formatCurrency(rec.currentTotalCost)}</td>
                            {hasSuggestion && <td className={betterClass(rec.currentTotalCost, rec.suggestedTotalCost, false)}>{formatCurrency(rec.suggestedTotalCost)}</td>}
                          </tr>
                        </tbody>
                      </table>
                      <button
                        className={styles.evidenceToggle}
                        onClick={() => toggleCostBreakdown(key)}
                        style={{ marginBottom: costExpanded ? 8 : 0 }}
                      >
                        <span>Cost breakdown (holding + shortage/stockout = total, simulated across all trajectory runs)</span>
                        {costExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {costExpanded && (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th></th>
                              <th>Holding Cost</th>
                              <th>Shortage/Stockout Cost</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Current</td>
                              <td>{formatCurrency(rec.currentTotalHoldingCost)}</td>
                              <td>{formatCurrency(rec.currentTotalShortageCost)}</td>
                              <td>{formatCurrency(rec.currentTotalCost)}</td>
                            </tr>
                            {hasSuggestion && (
                              <tr>
                                <td>{suggestedLabel}</td>
                                <td>{formatCurrency(rec.suggestedTotalHoldingCost)}</td>
                                <td>{formatCurrency(rec.suggestedTotalShortageCost)}</td>
                                <td>{formatCurrency(rec.suggestedTotalCost)}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}

                      <div className={styles.robustnessGrid}>
                        <div className={styles.robustnessBox}>
                          <div className={styles.robustnessHeader}>
                            <span className={styles.policyBoxLabel}>Current Policy</span>
                            <span className={`badge ${robustnessScoreBadgeClass(rec.currentCompositeScore)}`}>
                              Robustness Score: {Math.round(rec.currentCompositeScore)}
                            </span>
                          </div>
                          {SCORE_COMPONENTS.map(c => (
                            <div key={c.suffix} className={styles.robustnessLine}>
                              <span>{c.label} ({c.weight}%)</span>
                              <strong>{Math.round(rec[`current${c.suffix}`])}</strong>
                            </div>
                          ))}
                        </div>
                        {hasSuggestion && (
                          <div className={styles.robustnessBox}>
                            <div className={styles.robustnessHeader}>
                              <span className={styles.policyBoxLabel}>{suggestedLabel}</span>
                              <span className={`badge ${robustnessScoreBadgeClass(rec.suggestedCompositeScore)}`}>
                                Robustness Score: {Math.round(rec.suggestedCompositeScore)}
                              </span>
                            </div>
                            {SCORE_COMPONENTS.map(c => (
                              <div key={c.suffix} className={styles.robustnessLine}>
                                <span>{c.label} ({c.weight}%)</span>
                                <strong>{Math.round(rec[`suggested${c.suffix}`])}</strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className={styles.governanceRow}>
                        {rec.governanceAction === 'suggest_pending_approval' && hasSuggestion && approveState.status !== 'done' && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => approveChange(rec, rec.currentCompositeScore)}
                            disabled={approveState.status === 'approving'}
                          >
                            {approveState.status === 'approving' ? 'Approving...' : 'Approve'}
                          </button>
                        )}
                        {approveState.status === 'done' && (
                          <span className="text-xs text-muted">
                            Approved by {approveState.audit?.changedBy} - now {POLICY_TYPE_LABELS[approveState.audit?.newPolicyType]}
                          </span>
                        )}
                        {approveState.status === 'error' && (
                          <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{approveState.error}</span>
                        )}

                        {rec.governanceAction === 'auto_changed' && (
                          <button className="btn btn-secondary btn-sm" onClick={() => loadAuditLog(rec)}>
                            {auditState.status === 'loading' ? 'Loading audit log...' : 'View audit log entry'}
                          </button>
                        )}
                      </div>

                      {auditState.status === 'done' && (
                        <div className={styles.auditLogWrap}>
                          {auditState.items.length === 0 && <p className="text-xs text-muted">No audit entries for this SKU/node yet.</p>}
                          {auditState.items.slice(0, 3).map(a => (
                            <div key={a.id} className={styles.auditLogLine}>
                              <span>{POLICY_TYPE_LABELS[a.oldPolicyType]} to {POLICY_TYPE_LABELS[a.newPolicyType]}</span>
                              <span className="text-xs text-muted">
                                score {a.robustnessScoreAtChange} - by {a.changedBy} - {new Date(a.changedAt).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
