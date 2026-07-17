// Local fallback for the Parameter Drift view when the API is unavailable/unconfigured.
// This is the same illustrative data the page shipped with before Phase 3's live wiring;
// it is never presented as live data (see usePolicyDrift's `source` flag).
const PARAMETER_DRIFT = [
  {
    id: 'PD-001',
    metric: 'Safety Stock',
    skuCode: 'SKU-2003',
    sku: 'Coca-Cola Classic 330ml',
    node: 'Chennai Distribution Center',
    erpValue: 1375,
    platformValue: 1899,
    unit: 'cases',
    driftPct: 38.1,
    driftDirection: 'up',
    driftingSinceDays: 14,
    poCount: 23,
    poWindowWeeks: 8,
    evidence: [
      { label: 'Avg daily demand', from: '700 cases/day', to: '1,000 cases/day', note: '+43% over 8 weeks' },
      { label: 'Demand variability (sigmaD)', from: '95 cases/day', to: '142 cases/day', note: 'demand less predictable than when SS was last set' },
      { label: 'Actual lead time', from: '4.0 days (ERP)', to: '5.2 days (actual)', note: 'supplier taking longer than assumed' },
    ],
    explanation: 'The current Safety Stock of 1,375 cases was calculated when demand was 700/day and sigmaD was 95. With demand now at 1,000/day and sigmaD at 142, this buffer is no longer sufficient to protect against demand and supply uncertainty.',
    impact: [
      { label: 'Avg inventory increase', value: '+524 cases' },
      { label: 'Additional holding cost', value: 'INR 21,980 per cycle' },
      { label: 'Buffer coverage', value: '1.9 days (up from 1.375 days)' },
    ],
    actionLabel: 'Update SS',
  },
  {
    id: 'PD-002',
    metric: 'Reorder Point',
    skuCode: 'SKU-2027',
    sku: 'Sprite 330ml',
    node: 'Chennai Distribution Center',
    erpValue: 5200,
    platformValue: 7140,
    unit: 'cases',
    driftPct: 37.3,
    driftDirection: 'up',
    driftingSinceDays: 21,
    poCount: 19,
    poWindowWeeks: 8,
    evidence: [
      { label: 'Avg daily demand', from: '400 cases/day', to: '580 cases/day', note: '+45% over 8 weeks' },
      { label: 'Actual lead time (last 12 deliveries)', from: '4.5 days (ERP PLIFZ)', to: '6.1 days (actual)', note: 'supplier consistently 1.6 days late vs promise' },
      { label: 'Supplier OTIF', from: '-', to: '71%', note: 'on-time-in-full only 71% of orders; reliability adjustment applied' },
    ],
    explanation: 'The current ROP of 5,200 cases was set when demand was 400/day and lead time was assumed at 4.5 days. At 580/day and an actual LT of 6.1 days, replenishment is triggering too late - stock runs below safe levels before the new order arrives.',
    impact: [
      { label: 'Earlier trigger point', value: '+1,940 cases earlier in the cycle' },
      { label: 'Order frequency', value: 'unchanged' },
      { label: 'Lead-time demand coverage', value: 'fully covered at 580/day' },
      { label: 'Stockout-during-lead-time risk', value: 'significantly reduced' },
    ],
    actionLabel: 'Update ROP',
  },
  {
    id: 'PD-003',
    metric: 'Maximum Stock Level',
    skuCode: 'SKU-2037',
    sku: 'Fanta Orange 500ml',
    node: 'Chennai Distribution Center',
    erpValue: 9600,
    platformValue: 5460,
    unit: 'cases',
    driftPct: -43.1,
    driftDirection: 'down',
    driftingSinceDays: 28,
    poCount: 11,
    poWindowWeeks: 8,
    evidence: [
      { label: 'Avg daily demand', from: '380 cases/day', to: '210 cases/day', note: '-44.7% over 8 weeks, consistent decline (Wk1-2: 380 -> Wk3-4: 320 -> Wk5-6: 250 -> Wk7-8: 210)' },
      { label: 'Lead time', from: '4.8 days', to: '4.8 days', note: 'stable, no change' },
      { label: 'Review period', from: '7 days', to: '7 days', note: 'unchanged' },
    ],
    explanation: 'Current MAX of 9,600 causes the system to order up to 9,600 cases every cycle. With demand at only 210/day, this creates 45.7 days of cover on a product with a 90-day shelf life. Excess stock accumulates every cycle.',
    impact: [
      { label: 'Order qty reduction', value: '~4,140 cases per cycle' },
      { label: 'Holding cost reduction', value: 'INR 1,73,880 per cycle' },
      { label: 'Avg inventory', value: '~4,800 -> ~2,730 cases' },
      { label: 'Days of cover', value: '45.7 -> 26.0 days' },
      { label: 'Warehouse space freed', value: '165.6 m3 per cycle (4,140 x 0.04 m3/case)' },
    ],
    actionLabel: 'Update MAX',
  },
]

export function fallbackPolicyDrift() {
  return { items: PARAMETER_DRIFT, total: PARAMETER_DRIFT.length }
}
