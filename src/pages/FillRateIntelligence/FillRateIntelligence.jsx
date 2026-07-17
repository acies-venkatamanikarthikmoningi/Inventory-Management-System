import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle, ChevronDown, ChevronRight, ChevronUp, Eye, TrendingUp,
} from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useFillRateIntelligence, useMeasurement } from '../../hooks/useFillRateIntelligence'
import Drawer from '../../components/Drawer/Drawer'
import styles from './FillRateIntelligence.module.css'

// This dataset is genuinely single-node (see docs/implementation-status.md) - the
// selector is real and wired to every API call below, it just has one real value
// to offer right now rather than a fabricated list of alternatives. This is
// SalesOrder.node's real value ("Chennai Distribution Center") - NOT
// PurchaseOrder.node_code's short form ("CHEN-DC"), a different field/value in a
// different table; L1/L2/Triage all filter on SalesOrder.node.
const NODE_OPTIONS = ['Chennai Distribution Center']
const DEFAULT_DATE_FROM = '2026-06-01'
const DEFAULT_DATE_TO = '2026-06-07'
const FILL_RATE_BENCHMARK = 0.95
const RATE_BENCHMARK = 0.02

const PRIMARY_CAUSE_BUCKETS = [
  { key: 'Mixed', badgeClass: 'badge-warning' },
  { key: 'Forecast Side', badgeClass: 'badge-info' },
  { key: 'Supply Side', badgeClass: 'badge-primary' },
  { key: 'Unresolved — insufficient evidence', badgeClass: 'badge-default' },
]

// Option B (client-confirmed): DC-level and by-SKU Fill Rate on this page are both
// order-count-based ("Order Fill Rate" - verified against app/fill_rate/service.py:
// compute_fill_rate and compute_fill_rate_by_sku share the exact same
// _joined_fill_rate_rows join and filled_complete/total ratio, just grouped
// differently). A genuinely quantity-based "Case Fill Rate" (sum of cases shipped /
// sum of cases ordered) is NOT currently computed anywhere in this build - no
// endpoint sums shipped/ordered quantities - so it's documented here as a distinct,
// named formula for definitional clarity, not displayed as a live number anywhere
// that doesn't actually compute it.
const ORDER_FILL_RATE_FORMULA = '(Count of Orders Filled Complete / Total Placed Orders) × 100'
const CASE_FILL_RATE_FORMULA = '(Sum of Cases Shipped / Sum of Cases Ordered) × 100'

// The 6 real per-file data sources app/fill_rate/seed.py reads (see
// docs/implementation-status.md) - Goods Sent Register IS the fulfillment data
// source in this build (there is no separate "Fulfillment Log" file), and
// "Replenishment Parameters" is deliberately excluded: this module's
// LeadTimeBaseline/DemandBaseline drift baselines are self-contained and computed
// locally in fill_rate_db, never read from the main app's Phase-3 replenishment
// policy data (see service.py's Driver 4/5 docstrings - explicit isolation
// requirement).
const DATA_STREAMS = [
  { name: 'Order File / Sales Orders', detail: 'Order_File_Week1.xlsx → SalesOrder' },
  { name: 'Goods Sent Register', detail: 'Goods_Sent_Register.xlsx → GoodsSent (the fulfillment data source - no separate Fulfillment Log file exists in this build)' },
  { name: 'Inventory Snapshot', detail: 'Inventory_Snapshot.xlsx → InventorySnapshot' },
  { name: 'Purchase Orders', detail: 'Purchase_Orders.xlsx → PurchaseOrder' },
  { name: 'Goods Receipt Register', detail: 'Goods_Receipt_Register.xlsx → GoodsReceipt' },
  { name: 'Demand Forecast Data', detail: 'Demand_Forecast_Data.xlsx → DemandForecast' },
]

// Card 1 status tiering: no existing severity convention in this app maps to "how
// far below a Fill Rate benchmark" (Batch Tracking's Critical/High/Medium is
// expiry-day-based, a different domain), so this is a documented, simple threshold
// per the task's own permitted fallback: OK at/above benchmark, CRITICAL more than
// 20% relatively below benchmark (< 76% when benchmark is 95%), WARNING in between.
const fillRateSeverity = (fillRate, benchmark = FILL_RATE_BENCHMARK) => {
  if (fillRate == null) return 'unknown'
  if (fillRate >= benchmark) return 'ok'
  return fillRate < benchmark * 0.8 ? 'critical' : 'warning'
}

const DRIVER_LABELS = {
  forecastAccuracy: 'Forecast Accuracy',
  demandVariability: 'Demand Variability',
  supplierOtd: 'Supplier OTD',
  leadTimeVariability: 'Lead-Time Variability',
  parameterAge: 'Parameter Age',
}
const DRIVER_TO_SNAKE = {
  forecastAccuracy: 'forecast_accuracy',
  demandVariability: 'demand_variability',
  supplierOtd: 'supplier_otd',
  leadTimeVariability: 'lead_time_variability',
  parameterAge: 'parameter_age',
}
const SNAKE_TO_LABEL = {
  forecast_accuracy: 'Forecast Accuracy',
  demand_variability: 'Demand Variability',
  supplier_otd: 'Supplier OTD',
  lead_time_variability: 'Lead-Time Variability',
  parameter_age: 'Parameter Age',
  structural_stockout: 'Structural Stockout',
}

const pct = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const num = value => value == null ? '—' : Math.round(value).toLocaleString('en-IN')
// Period average of a dosTrend array's non-null dos values - a display-only
// aggregation (the per-day trend itself, and the Sparkline plotting every
// point, are untouched) so this card's headline stat matches the "average"
// aggregation every other card on this page uses (Fill Rate, Stockout Rate,
// Backorder Rate), instead of the old first-day/last-day pair, which wasn't
// an aggregate at all and read as an inconsistent aggregation method.
const avgDos = trend => {
  const values = (trend || []).map(p => p.dos).filter(v => v != null)
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}
const addDays = (isoDate, days) => {
  const d = new Date(isoDate)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Destinations built from the actual query-param conventions those pages already
// support (see Replenishment.jsx / Inbound.jsx) - extended minimally where a
// pattern didn't fully exist yet (tab=drift's sku seeding, tab=optimization's sku
// filter + auto-run, Inbound's ?view=autoAsn).
const ACTION_DESTINATIONS = {
  'Update ERP Parameters': { label: 'Parameter Drift', to: sku => `/app/replenishment?tab=drift&sku=${encodeURIComponent(sku)}` },
  'Update Inventory Policies': { label: 'Parameter Drift', to: sku => `/app/replenishment?tab=drift&sku=${encodeURIComponent(sku)}` },
  'Expedite PO': { label: 'Auto ASN', to: (sku, ctx) => `/app/inbound?view=autoAsn&sku=${encodeURIComponent(sku)}&qty=${Math.round(ctx.qty || 0)}` },
  'Raise STO': { label: 'IN Transfers', to: sku => `/app/replenishment?tab=optimization&direction=in&sku=${encodeURIComponent(sku)}` },
}

function buildActionGist(action, sku, rca, node) {
  const reasons = rca.recommendationReasons[action] || []
  const driftPct = rca.step5.driftPct
  const gapPct = rca.step4.gapPct
  if (action === 'Update ERP Parameters' || action === 'Update Inventory Policies') {
    const parts = []
    if (reasons.some(r => r.driver === 'demand_variability' || r.driver === 'parameter_age')) {
      parts.push(`demand variability has drifted from the stored baseline (RMSE_D drift ${driftPct != null ? pct(driftPct) : 'n/a'})`)
    }
    if (reasons.some(r => r.driver === 'structural_stockout')) {
      parts.push(`starting on-hand fell structurally short of the Risk Horizon's Required Inventory (gap ${gapPct != null ? pct(gapPct) : 'n/a'})`)
    }
    return `${sku}'s Safety Stock is based on outdated assumptions: ${parts.join(' and ')}.`
  }
  const supplierReasons = reasons.filter(r => r.driver === 'supplier_otd' || r.driver === 'lead_time_variability')
  const anyCausal = supplierReasons.some(r => r.wasCausal)
  const driverLabel = supplierReasons.map(r => SNAKE_TO_LABEL[r.driver]).join(' and ') || 'a supplier-side driver'
  return action === 'Expedite PO'
    ? `${sku} has a ${anyCausal ? 'confirmed' : 'flagged but non-causal-for-this-event'} delivery risk (${driverLabel}). Recommended: expedite or raise an auto-replenishment request.`
    : `${sku} is short at ${node}. ${driverLabel} is ${anyCausal ? 'the confirmed cause' : 'flagged but not proven causal for this event'} - check network-wide stock positions for a feasible inter-DC transfer.`
}

// Plots every point in the real day-by-day dosTrend array (not just first/last) -
// hover shows each day's exact value via the native <title> tooltip, so the full
// trend stays numerically inspectable, not just visually implied.
function Sparkline({ points, width = 140, height = 32 }) {
  const values = points.map(p => p.dos).filter(v => v != null)
  if (values.length === 0) return <span className="text-xs text-muted">No DoS data</span>
  const max = Math.max(...values, 0.01)
  const step = points.length > 1 ? width / (points.length - 1) : 0
  const path = points.map((p, i) => {
    const y = p.dos == null ? height : height - (p.dos / max) * height
    return `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const title = points.map(p => `${p.date}: ${p.dos != null ? p.dos.toFixed(2) : 'n/a'} days`).join('\n')
  return (
    <svg width={width} height={height} className={styles.sparkline}>
      <title>{title}</title>
      <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
    </svg>
  )
}

function LoadingRow({ label }) {
  return <div className={styles.loadingRow}><div className={styles.spinner} />{label}</div>
}

function UnavailableRow({ error }) {
  return <div className="empty-state"><AlertTriangle size={24} /><p>{error || 'Data unavailable'}</p></div>
}

// Hand-rolled SVG ring (same raw-SVG approach this file's Sparkline already uses,
// rather than pulling recharts into a file that doesn't otherwise use it) so the
// 95%-benchmark tick can be placed at an exact, deterministic angle - a real value
// from GET /api/v1/fill-rate/summary, nothing simulated. 0% starts at 12 o'clock and
// progresses clockwise; the tick mark uses the identical -90deg reference frame the
// progress arc's own `rotate(-90)` transform establishes.
//
// Clarity fix: thicker ring (18px vs the old 14px) with a solid, clearly-visible
// gray track (var(--color-text-light), not the near-invisible var(--color-border)
// hairline color the old track used) against the vivid severity-colored arc; the
// benchmark tick is now a thicker, longer, rounded-cap marker with its own "95%
// target" text label along the same radial ray. The SVG canvas is padded beyond the
// ring's own diameter so the tick/label never clip against the viewBox edge.
function FillRateRing({ value, benchmark = FILL_RATE_BENCHMARK, status, ringSize = 140 }) {
  const stroke = 18
  const pad = 34
  const canvas = ringSize + pad * 2
  const radius = (ringSize - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(1, value ?? 0))
  const dash = circumference * clamped
  const cx = canvas / 2
  const cy = canvas / 2
  const colorVar = status === 'critical' ? 'var(--color-danger)' : status === 'warning' ? 'var(--color-warning)' : 'var(--color-success)'

  const tickAngleDeg = benchmark * 360 - 90
  const tickRad = (tickAngleDeg * Math.PI) / 180
  const tickInner = radius - stroke / 2 - 5
  const tickOuter = radius + stroke / 2 + 7
  const tx1 = cx + tickInner * Math.cos(tickRad)
  const ty1 = cy + tickInner * Math.sin(tickRad)
  const tx2 = cx + tickOuter * Math.cos(tickRad)
  const ty2 = cy + tickOuter * Math.sin(tickRad)
  const labelR = radius + stroke / 2 + 20
  const lx = cx + labelR * Math.cos(tickRad)
  const ly = cy + labelR * Math.sin(tickRad)

  return (
    <div className={styles.ringWrap} style={{ width: canvas, height: canvas }}>
      <svg width={canvas} height={canvas} viewBox={`0 0 ${canvas} ${canvas}`}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--color-text-light)" strokeWidth={stroke} />
        <circle
          cx={cx} cy={cy} r={radius} fill="none" stroke={colorVar} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="var(--color-text)" strokeWidth={3} strokeLinecap="round">
          <title>{`${pct(benchmark)} benchmark`}</title>
        </line>
        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="9" fontWeight="700" fill="var(--color-text)">
          {(benchmark * 100).toFixed(0)}% target
        </text>
      </svg>
      <div className={styles.ringCenter}>
        <span className={styles.ringPct} style={{ color: colorVar }}>{pct(value)}</span>
        <span className={styles.ringCaption}>Order Fill Rate</span>
      </div>
    </div>
  )
}

// Part A header banner. "How this is calculated" is the only genuinely expandable
// link per the task; Data Streams Evaluated is shown as an always-visible panel of
// real source files (see DATA_STREAMS) rather than hidden behind a second toggle.
function FillRateBanner() {
  const [showCalc, setShowCalc] = useState(false)
  return (
    <div className={styles.banner}>
      <span className={styles.bannerBadge}>TARGET: &gt; {(FILL_RATE_BENCHMARK * 100).toFixed(0)}% FILL RATE</span>
      <h2 className={styles.bannerHeading}>Objective Function: Maximize DC Fill Rate</h2>
      <p className={styles.bannerDesc}>
        Fill Rate is the primary service-level KPI. Underperforming fill rates indicate missed customer
        orders, immediate revenue loss, and service degradation.
      </p>
      <button type="button" className={styles.bannerLink} onClick={() => setShowCalc(v => !v)} aria-expanded={showCalc}>
        How this is calculated {showCalc ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {showCalc && (
        <div className={styles.bannerPanel}>
          <div className={styles.formulaBlock}>
            <strong>Order Fill Rate</strong> <span className="text-xs">— what this page's DC-level and by-SKU figures compute today</span>
            <p className={styles.driverFormula}>{ORDER_FILL_RATE_FORMULA}</p>
          </div>
          <div className={styles.formulaBlock}>
            <strong>Case Fill Rate</strong> <span className="text-xs">— documented for definitional clarity; not currently computed anywhere in this build's data model (no endpoint sums shipped/ordered case quantities)</span>
            <p className={styles.driverFormula}>{CASE_FILL_RATE_FORMULA}</p>
          </div>
          <p>
            Order Fill Rate measures how many orders were completely fulfilled; Case Fill Rate measures
            what percentage of total ordered units were shipped — these are intentionally different,
            complementary metrics.
          </p>
        </div>
      )}
      <div className={styles.streamsPanel}>
        <span className={styles.streamsTitle}>Data Streams Evaluated</span>
        <div className={styles.streamChips}>
          {DATA_STREAMS.map(s => (
            <span key={s.name} className={styles.streamChip} title={s.detail}>{s.name}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// Card 1 - reuses fr.summary exactly as the old L1 KPI card did (same status
// states, same data), just presented as a ring instead of a bare percentage.
function L1SummaryCard({ summary, expanded, onClick }) {
  if (summary.status === 'loading') {
    return <div className={`${styles.summaryCard} ${styles.summaryCardStatic}`}><LoadingRow label="Loading Fill Rate summary..." /></div>
  }
  if (summary.status === 'unavailable') {
    return <div className={`${styles.summaryCard} ${styles.summaryCardStatic}`}><UnavailableRow error={summary.error} /></div>
  }
  const { fillRate, ordersFilledComplete, totalOrders } = summary.data
  const severity = fillRateSeverity(fillRate)
  const badgeClass = severity === 'critical' ? 'badge-danger' : severity === 'warning' ? 'badge-warning' : 'badge-success'
  return (
    <button type="button" className={styles.summaryCard} onClick={onClick} aria-expanded={expanded}>
      <div className={styles.summaryCardHeader}>
        <span className={styles.summaryCardTitle}>L1 — DC Service Level Outcome</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>
      <FillRateRing value={fillRate} benchmark={FILL_RATE_BENCHMARK} status={severity} />
      <span className={`badge ${badgeClass}`} style={{ marginTop: 8 }}>{severity.toUpperCase()}</span>
      <div className={styles.summaryCardFooterNums}>
        <div><strong>{num(ordersFilledComplete)}</strong><span>Orders Filled Complete</span></div>
        <div><strong>{num(totalOrders)}</strong><span>Total Placed Orders</span></div>
      </div>
    </button>
  )
}

// L2's per-metric "logic" panels - the SAME click-to-expand formula+benchmark+
// raw-numbers pattern DriverDetail already built for the L3 Driver Evidence strip
// (reused here, not rebuilt), fed ONLY by fields GET /api/v1/fill-rate/diagnostics
// already returns: totalOrders/stockoutCount/backorderCount were being computed by
// compute_stockout_backorder_rates all along but silently dropped before reaching
// the API response - see service.py's get_l2_diagnostics - so they're now forwarded
// there instead of being reverse-engineered from a rounded percentage here.
function DiagnosticDetail({ metricKey, d, dateFrom, dateTo }) {
  switch (metricKey) {
    case 'stockout':
      return (
        <div className={styles.driverDetailBody}>
          <p><strong>Stockout Rate</strong>: % of times a specific SKU is unavailable for customer purchase.</p>
          <p className={styles.driverFormula}>(Stock-Out Events ÷ Total Orders) × 100</p>
          <p className="text-xs text-muted">Benchmark: &lt; 2%</p>
          <p className="text-xs text-muted">This directly correlates to lost revenue — it measures customer service failure and replenishment timing issues.</p>
          <ul>
            <li>Stock-Out Events: <strong>{num(d.stockoutCount)}</strong></li>
            <li>Total Orders: <strong>{num(d.totalOrders)}</strong></li>
          </ul>
          <p>Result: <strong>{pct(d.stockoutRate)}</strong> — {d.isStockoutException ? 'FLAGGED (≥ 2% benchmark)' : 'OK'}</p>
        </div>
      )
    case 'backorder':
      return (
        <div className={styles.driverDetailBody}>
          <p><strong>Backorder Rate</strong>: Percentage of orders not fulfilled immediately.</p>
          <p className={styles.driverFormula}>(Backorder Events ÷ Total Orders) × 100</p>
          <p className="text-xs text-muted">Benchmark: &lt; 3% is typical (this system flags at ≥ 2%, matching the Stockout Rate threshold - see `RATE_BENCHMARK` in the backend).</p>
          <p className="text-xs text-muted">Shows how often replenishment lags behind demand.</p>
          <ul>
            <li>Backorder Events: <strong>{num(d.backorderCount)}</strong></li>
            <li>Total Orders: <strong>{num(d.totalOrders)}</strong></li>
          </ul>
          <p>Result: <strong>{pct(d.backorderRate)}</strong> — {d.isBackorderException ? 'FLAGGED (≥ 2% benchmark)' : 'OK'}</p>
        </div>
      )
    case 'dos': {
      const avgDosVal = avgDos(d.dosTrend)
      return (
        <div className={styles.driverDetailBody}>
          <p><strong>Days of Supply</strong>: how many days current on-hand inventory will last at the current demand rate.</p>
          <p className={styles.driverFormula}>On-Hand Inventory (EOD) ÷ Daily Demand — DC-level: Total On-Hand across all SKUs ÷ Total Daily Demand across all SKUs</p>
          <p className="text-xs text-muted">Demand used is the REAL same-day order total for the period, not a smoothed average — this makes DoS sensitive to real spikes.</p>
          <p className="text-xs text-muted">Avg DoS is averaged across {dateFrom} – {dateTo}; day-by-day values feeding that average:</p>
          <ul>
            {(d.dosTrend || []).map(p => (
              <li key={p.date}>{p.date}: On-Hand <strong>{num(p.onHand)}</strong> ÷ Demand <strong>{num(p.demand)}</strong> = <strong>{p.dos != null ? p.dos.toFixed(2) : 'n/a'}</strong> days</li>
            ))}
          </ul>
          <p>Result: Avg DoS <strong>{avgDosVal != null ? avgDosVal.toFixed(2) : '—'}</strong> days</p>
        </div>
      )
    }
    default:
      return null
  }
}

const L2_METRICS = [
  { key: 'stockout', label: 'Avg Stockout Rate', value: d => pct(d.stockoutRate), color: d => d.isStockoutException ? 'var(--color-danger)' : 'var(--color-success)' },
  { key: 'backorder', label: 'Avg Backorder Rate', value: d => pct(d.backorderRate), color: d => d.isBackorderException ? 'var(--color-danger)' : 'var(--color-success)' },
  { key: 'dos', label: 'Avg DoS', value: d => `${avgDos(d.dosTrend) != null ? avgDos(d.dosTrend).toFixed(2) : '—'} days`, color: () => 'var(--color-text)' },
]

// Card 2 - reuses fr.diagnostics exactly as the old L2 diagnostics card did (same
// status states, same data, same onClick toggling the by-SKU drill-down panel
// below - now via a dedicated header button since each metric also needs its own
// independent click target, and a button can't nest inside another button).
// stockoutRate === backorderRate is flagged inline rather than hidden - see
// docs/implementation-status.md for the live-verified, independently-computed,
// mutually-exclusive math proving this is a genuine data coincidence for this
// period, not a shared calculation bug.
function L2SummaryCard({ diagnostics, expanded, onClick, dateFrom, dateTo }) {
  const [expandedMetric, setExpandedMetric] = useState(null)
  if (diagnostics.status === 'loading') {
    return <div className={`${styles.summaryCard} ${styles.summaryCardStatic}`}><LoadingRow label="Loading diagnostics..." /></div>
  }
  if (diagnostics.status === 'unavailable') {
    return <div className={`${styles.summaryCard} ${styles.summaryCardStatic}`}><UnavailableRow error={diagnostics.error} /></div>
  }
  const d = diagnostics.data
  const identicalRates = d.stockoutRate === d.backorderRate
  const toggleMetric = key => setExpandedMetric(prev => (prev === key ? null : key))

  return (
    <div className={styles.summaryCard}>
      <button type="button" className={styles.summaryCardHeaderBtn} onClick={onClick} aria-expanded={expanded}>
        <span className={styles.summaryCardTitle}>L2 — DC Diagnostic Summary</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      <div className={styles.l2Metrics}>
        {L2_METRICS.map(m => {
          const isOpen = expandedMetric === m.key
          return (
            <button
              key={m.key}
              type="button"
              className={`${styles.l2MetricBtn} ${isOpen ? styles.l2MetricBtnActive : ''}`}
              onClick={() => toggleMetric(m.key)}
              aria-expanded={isOpen}
            >
              <span className={styles.l2MetricLabel}>{m.label} {isOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}</span>
              <strong style={{ color: m.color(d) }}>{m.value(d)}</strong>
            </button>
          )
        })}
      </div>
      {expandedMetric && (
        <div className={styles.driverDetail} style={{ width: '100%' }}>
          <DiagnosticDetail metricKey={expandedMetric} d={d} dateFrom={dateFrom} dateTo={dateTo} />
        </div>
      )}
      {identicalRates && (
        <p className={styles.identicalRatesNote}>
          Stockout and Backorder Rate are equal this period — independently computed, mutually-exclusive
          order counts that happen to total the same count in the real data. Confirmed not a shared
          calculation bug (see docs).
        </p>
      )}
    </div>
  )
}

// Card 3 - reuses the SAME bucketCounts already computed for Section 3's bucket
// tabs (from the real triage+RCA results), just re-displayed as 3 headline counts
// (Forecast Side / Supply Side / Mixed) plus a smaller Unresolved count - no SKU's
// real primaryCause is dropped or relabeled, only re-grouped for this compact view.
// Clicking scrolls to Section 3, which already owns the bucket-selection/drill-down
// behavior - not duplicated here.
function L3SummaryCard({ bucketCounts, triageStatus, onClick }) {
  const forecast = bucketCounts['Forecast Side'] || 0
  const supply = bucketCounts['Supply Side'] || 0
  const mixed = bucketCounts['Mixed'] || 0
  const unresolved = bucketCounts['Unresolved — insufficient evidence'] || 0
  return (
    <button type="button" className={styles.summaryCard} onClick={onClick}>
      <div className={styles.summaryCardHeader}>
        <span className={styles.summaryCardTitle}>L3 — Root Cause Split</span>
        <ChevronRight size={14} />
      </div>
      {triageStatus === 'loading' && <LoadingRow label="Loading triage..." />}
      {triageStatus === 'unavailable' && <UnavailableRow />}
      {triageStatus === 'done' && (
        <>
          <div className={styles.l3Counts}>
            <div className={styles.l3Count}><strong>{forecast}</strong><span>Forecast Side</span></div>
            <div className={styles.l3Count}><strong>{supply}</strong><span>Supply Side</span></div>
            <div className={styles.l3Count}><strong>{mixed}</strong><span>Mixed</span></div>
          </div>
          {unresolved > 0 && <p className={styles.l3Other}>+{unresolved} Unresolved — insufficient evidence</p>}
        </>
      )}
    </button>
  )
}

const dec = value => value == null ? '—' : value.toFixed(2)

// Every driver's formula + raw-input breakdown, built ONLY from fields
// screen_all_drivers() (GET /api/v1/fill-rate/drivers/screen) already returns
// for this sku - no separate computation or approximation of numbers the API
// doesn't already expose.
function DriverDetail({ driverKey, d }) {
  if (!d || !d.status) return <p className="text-xs text-muted">No driver data for this SKU.</p>

  if (d.status === 'insufficient_data') {
    return <p className="text-xs text-muted">Insufficient data for this SKU/period - no raw inputs available to compute this driver.</p>
  }

  switch (driverKey) {
    case 'forecastAccuracy':
      return (
        <div className={styles.driverDetailBody}>
          <p className={styles.driverFormula}>Forecast Accuracy = 1 − |Actual − Forecasted| / Forecasted</p>
          <ul>
            <li>Actual demand: <strong>{num(d.actualDemand)}</strong> units</li>
            <li>Forecasted demand: <strong>{num(d.forecastedDemand)}</strong> units</li>
          </ul>
          <p>Result: <strong>{pct(d.accuracy)}</strong> accuracy — {d.flag ? 'FLAGGED (below 85% benchmark)' : 'OK'}</p>
        </div>
      )
    case 'demandVariability':
      return (
        <div className={styles.driverDetailBody}>
          <p className={styles.driverFormula}>CV = σ_D (Demand Std. Dev.) / ADD (Average Daily Demand)</p>
          <ul>
            <li>σ_D: <strong>{dec(d.sigmaD)}</strong> units</li>
            <li>ADD: <strong>{dec(d.meanDemand)}</strong> units</li>
          </ul>
          <p>Result: CV <strong>{dec(d.cv)}</strong> — {d.flag ? 'FLAGGED (above 0.50 benchmark)' : 'OK'}</p>
        </div>
      )
    case 'supplierOtd':
      return (
        <div className={styles.driverDetailBody}>
          <p className={styles.driverFormula}>Supplier OTD = On-Time POs / Total POs Compared</p>
          <ul>
            <li>POs compared: <strong>{d.poCount}</strong></li>
          </ul>
          <p>Result: <strong>{pct(d.otdPct)}</strong> on-time — {d.flag ? 'FLAGGED (below 95% benchmark)' : 'OK'}</p>
        </div>
      )
    case 'leadTimeVariability':
      if (d.status === 'baseline_established') {
        return (
          <div className={styles.driverDetailBody}>
            <p className={styles.driverFormula}>Drift % = (Fresh RMSE_LT − Baseline RMSE_LT) / Baseline RMSE_LT</p>
            <ul>
              <li>Fresh RMSE_LT: <strong>{dec(d.rmseLt)}</strong> days</li>
            </ul>
            <p>First run for this SKU - baseline established this run. Drift comparison available on the next run.</p>
          </div>
        )
      }
      return (
        <div className={styles.driverDetailBody}>
          <p className={styles.driverFormula}>Drift % = (Fresh RMSE_LT − Baseline RMSE_LT) / Baseline RMSE_LT</p>
          <ul>
            <li>Fresh RMSE_LT: <strong>{dec(d.rmseLt)}</strong> days</li>
            <li>Baseline RMSE_LT: <strong>{dec(d.baselineRmseLt)}</strong> days</li>
          </ul>
          <p>Result: drift <strong>{d.driftPct != null ? pct(d.driftPct) : 'n/a'}</strong> — {d.flag ? 'FLAGGED (>15% drift)' : 'OK'}</p>
        </div>
      )
    case 'parameterAge':
      if (d.status === 'baseline_established') {
        return (
          <div className={styles.driverDetailBody}>
            <p className={styles.driverFormula}>Drift % = (Fresh RMSE_D − Baseline RMSE_D) / Baseline RMSE_D</p>
            <ul>
              <li>Fresh RMSE_D: <strong>{dec(d.rmseD)}</strong> units</li>
            </ul>
            <p>First run for this SKU - baseline established this run. Drift comparison available on the next run.</p>
          </div>
        )
      }
      return (
        <div className={styles.driverDetailBody}>
          <p className={styles.driverFormula}>Drift % = (Fresh RMSE_D − Baseline RMSE_D) / Baseline RMSE_D</p>
          <ul>
            <li>Fresh RMSE_D: <strong>{dec(d.rmseD)}</strong> units</li>
            <li>Baseline RMSE_D: <strong>{dec(d.baselineRmseD)}</strong> units</li>
          </ul>
          <p>Result: drift <strong>{d.driftPct != null ? pct(d.driftPct) : 'n/a'}</strong> — {d.flag ? 'FLAGGED (>15% drift)' : 'OK'}</p>
        </div>
      )
    default:
      return null
  }
}

// Click-to-expand: each chip stays a compact flag/status summary until
// clicked, then reveals the formula + this SKU's real raw inputs (Part D,
// client-mandated) - sourced entirely from driverRow, itself one item of the
// already-fetched GET /api/v1/fill-rate/drivers/screen response.
function DriverEvidenceStrip({ driverRow }) {
  const [expandedKey, setExpandedKey] = useState(null)
  if (!driverRow) return null
  return (
    <div className={styles.driverStrip}>
      {Object.entries(DRIVER_LABELS).map(([key, label]) => {
        const d = driverRow[key] || {}
        const isOpen = expandedKey === key
        return (
          <div key={key} className={styles.driverChip}>
            <button
              type="button"
              className={styles.driverChipToggle}
              onClick={() => setExpandedKey(isOpen ? null : key)}
              aria-expanded={isOpen}
            >
              <span className={styles.driverChipLabel}>{label} {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</span>
              <span className={`badge ${d.flag ? 'badge-danger' : 'badge-success'}`}>{d.flag ? 'FLAG' : 'ok'}</span>
              <span className={styles.driverChipStatus}>{d.status || 'n/a'}</span>
            </button>
            {isOpen && (
              <div className={styles.driverDetail}>
                <DriverDetail driverKey={key} d={d} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Shared by Section 3's drawer detail AND Section 4's flat list - one approval
// path, reused, never duplicated.
function RcaCard({ rca, driverRow, skuName, node, appliedActions, onApprove, approvedBy, onOpenSku }) {
  const navigate = useNavigate()
  const [checked, setChecked] = useState(new Set())
  const [applying, setApplying] = useState(false)
  const pendingActions = rca.recommendation.filter(a => !appliedActions.has(a))
  const approvedActions = rca.recommendation.filter(a => appliedActions.has(a))

  const toggle = action => setChecked(prev => {
    const next = new Set(prev)
    next.has(action) ? next.delete(action) : next.add(action)
    return next
  })

  const submit = async () => {
    if (checked.size === 0) return
    setApplying(true)
    try {
      const result = await onApprove(rca.skuCode, [...checked], approvedBy)
      setChecked(new Set())
      return result
    } finally {
      setApplying(false)
    }
  }

  const bucket = PRIMARY_CAUSE_BUCKETS.find(b => b.key === rca.primaryCause)

  return (
    <div className={`card ${styles.rcaCard}`}>
      <div className={styles.rcaCardHeader}>
        <div>
          <button className={styles.skuLink} onClick={() => onOpenSku(rca.skuCode)}>
            <span className={styles.insightType}>{skuName}</span>
            <code>{rca.skuCode}</code>
          </button>
        </div>
        <div>
          <span className="text-xs text-muted" style={{ marginRight: 8 }}>RCA Verdict:</span>
          <span className={`badge ${bucket?.badgeClass || 'badge-default'}`}>{rca.primaryCause}</span>
        </div>
      </div>

      <div className={styles.rcaStep}>
        <h4>1. Service Loss Attribution</h4>
        <p><strong>{num(rca.step1.unservedUnits)}</strong> units unserved this period</p>
      </div>

      <div className={styles.rcaStep}>
        <h4>2. Stockout Driver Analysis</h4>
        <p>
          Starting On-Hand Inventory (Start of Period): <strong>{num(rca.step2.startingOnHand)}</strong>
          {' '}&middot;{' '}
          Required Inventory <span className="text-xs text-muted" title="Inventory needed to satisfy demand across the Risk Horizon">(Risk Horizon)</span>: <strong>{num(rca.step2.requiredBuffer)}</strong>
        </p>
        <span className={`badge ${rca.step2.wasStructurallyInsufficient ? 'badge-danger' : 'badge-success'}`}>
          {rca.step2.wasStructurallyInsufficient ? '⚠ Structurally insufficient' : '✓ OK'}
        </span>
      </div>

      <div className={styles.rcaStep}>
        <h4>3. Forecast vs Supply Attribution</h4>
        {rca.step3.causalDrivers.length > 0 && (
          <ul className={styles.driverList}>
            {rca.step3.causalDrivers.map(d => (
              <li key={d} className={styles.driverListCausal}><CheckCircle size={13} /> {SNAKE_TO_LABEL[d] || d} - confirmed causal</li>
            ))}
          </ul>
        )}
        {rca.step3.noncausalButRealDrivers.length > 0 && (
          <ul className={styles.driverList}>
            {rca.step3.noncausalButRealDrivers.map(d => (
              <li key={d} className={styles.driverListNoncausal}>{SNAKE_TO_LABEL[d] || d} - flagged but not causal for this specific event</li>
            ))}
          </ul>
        )}
        {rca.step3.causalDrivers.length === 0 && rca.step3.noncausalButRealDrivers.length === 0 && (
          <p className="text-xs text-muted">No driver evidence for this SKU.</p>
        )}
      </div>

      <div className={styles.rcaStep}>
        <h4>4. Inventory Position Analysis</h4>
        <p>Starting On-Hand covered <strong>{rca.step4.gapPct != null ? pct(1 - rca.step4.gapPct) : '—'}</strong> of the Required Inventory for the Risk Horizon</p>
      </div>

      <div className={styles.rcaStep}>
        <h4>5. Policy Drift Analysis</h4>
        <span className={`badge ${rca.step5.isStale ? 'badge-danger' : 'badge-success'}`}>{rca.step5.isStale ? '⚠ CONFIRMED' : 'OK'}</span>
        <span style={{ marginLeft: 8 }}>drift {rca.step5.driftPct != null ? pct(rca.step5.driftPct) : 'n/a'} vs. stored baseline</span>
      </div>

      <div className={styles.rcaStep}>
        <h4>Driver Evidence</h4>
        <DriverEvidenceStrip driverRow={driverRow} />
      </div>

      {pendingActions.length > 0 && (
        <div className={styles.actionChecklist}>
          <h4>Recommended Actions</h4>
          {pendingActions.map(action => {
            const dest = ACTION_DESTINATIONS[action]
            return (
              <label key={action} className={styles.actionRow}>
                <input type="checkbox" checked={checked.has(action)} onChange={() => toggle(action)} />
                <div className={styles.actionRowBody}>
                  <strong>{action}</strong>
                  <p>{buildActionGist(action, rca.skuCode, rca, node)}</p>
                  {dest && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => navigate(dest.to(rca.skuCode, { qty: rca.step1.unservedUnits }))}
                    >
                      View in {dest.label} <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              </label>
            )
          })}
          <button className="btn btn-primary btn-sm" disabled={checked.size === 0 || applying} onClick={submit}>
            {applying ? 'Approving...' : `Approve Selected (${checked.size})`}
          </button>
        </div>
      )}
      {approvedActions.length > 0 && (
        <p className={styles.approvedNote}><CheckCircle size={13} /> Already approved: {approvedActions.join(', ')}</p>
      )}
      {pendingActions.length === 0 && approvedActions.length === 0 && (
        <p className="text-xs text-muted">No actionable recommendation for this SKU.</p>
      )}
    </div>
  )
}

function MeasurementStrip({ skuCode, period }) {
  const measurement = useMeasurement(skuCode, period)
  useEffect(() => { measurement.load() }, [skuCode, period.afterFrom, period.afterTo]) // eslint-disable-line react-hooks/exhaustive-deps
  if (measurement.status !== 'done') return null
  const { beforeFillRate, afterFillRate, improved } = measurement.data
  return (
    <div className={`card ${styles.measurementStrip}`}>
      <code>{skuCode}</code>: <span title={ORDER_FILL_RATE_FORMULA}>Order Fill Rate</span> before <strong>{pct(beforeFillRate)}</strong> &rarr; after <strong>{pct(afterFillRate)}</strong>
      <span className={`badge ${improved ? 'badge-success' : 'badge-warning'}`} style={{ marginLeft: 8 }}>
        {improved ? '✅ Improved' : '⚠ No improvement'}
      </span>
    </div>
  )
}

export default function FillRateIntelligence() {
  const { user, showToast } = useApp()
  const navigate = useNavigate()
  const [node, setNode] = useState(NODE_OPTIONS[0])
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM)
  const [dateTo, setDateTo] = useState(DEFAULT_DATE_TO)
  const [showBySkuFillRate, setShowBySkuFillRate] = useState(false)
  const [showBySkuDiagnostics, setShowBySkuDiagnostics] = useState(false)
  const [activeBucket, setActiveBucket] = useState('Mixed')
  const [drawerSku, setDrawerSku] = useState(null)
  const rcaSectionRef = useRef(null)
  const scrollToRcaSection = () => rcaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const fr = useFillRateIntelligence({ node, dateFrom, dateTo })

  const openSku = skuCode => navigate(`/app/sku-explore?sku=${encodeURIComponent(skuCode)}`)

  const bySkuMap = useMemo(() => {
    const map = new Map()
    if (fr.bySku.status === 'done') fr.bySku.data.items.forEach(item => map.set(item.skuCode, item))
    return map
  }, [fr.bySku])

  const driverBySku = useMemo(() => {
    const map = new Map()
    if (fr.driverScreen.status === 'done') fr.driverScreen.data.items.forEach(item => map.set(item.skuCode, item))
    return map
  }, [fr.driverScreen])

  const triageItems = fr.triage.status === 'done' ? fr.triage.data.items : []
  const responsibleItems = triageItems.filter(i => i.status === 'responsible')
  const needsAttentionItems = triageItems.filter(i => i.status === 'watch' || i.status === 'unexplained')

  const rcaEntries = responsibleItems
    .map(item => ({ triage: item, rca: fr.rcaBySku[item.skuCode] }))
    .filter(entry => entry.rca?.status === 'done')

  const bucketCounts = useMemo(() => {
    const counts = {}
    PRIMARY_CAUSE_BUCKETS.forEach(b => { counts[b.key] = 0 })
    rcaEntries.forEach(entry => { counts[entry.rca.data.primaryCause] = (counts[entry.rca.data.primaryCause] || 0) + 1 })
    return counts
  }, [rcaEntries])

  const bucketSkus = rcaEntries.filter(entry => entry.rca.data.primaryCause === activeBucket)

  const pendingEntries = rcaEntries.filter(entry => {
    const applied = fr.appliedActionsBySku[entry.triage.skuCode] || new Set()
    return entry.rca.data.recommendation.some(a => !applied.has(a))
  })

  const measurementPeriod = useMemo(() => ({
    beforeFrom: dateFrom, beforeTo: dateTo,
    afterFrom: addDays(dateTo, 1), afterTo: addDays(dateTo, 7),
  }), [dateFrom, dateTo])

  const appliedSkus = Object.keys(fr.appliedActionsBySku).filter(sku => fr.appliedActionsBySku[sku].size > 0)

  const drawerEntry = drawerSku ? rcaEntries.find(e => e.triage.skuCode === drawerSku) : null

  return (
    <div>
      <FillRateBanner />

      <div className={`card ${styles.filterBar}`}>
        <div className={styles.filterField}>
          <span className="text-xs text-muted">Node</span>
          <select className="form-select" value={node} onChange={e => setNode(e.target.value)}>
            {NODE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className={styles.filterField}>
          <span className="text-xs text-muted">From</span>
          <input className="form-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className={styles.filterField}>
          <span className="text-xs text-muted">To</span>
          <input className="form-input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
      </div>

      {/* L1/L2/L3 summary row - same underlying state/data as the old Section 1/2
          KPI cards and Section 3's bucket counts; only the trigger UI changed
          (donut/count cards instead of a bare KPI button), so every click below
          toggles the EXACT same state that already drives the EXACT same
          drill-down tables/sections further down the page. */}
      <div className={styles.summaryRow}>
        <L1SummaryCard summary={fr.summary} expanded={showBySkuFillRate} onClick={() => setShowBySkuFillRate(v => !v)} />
        <L2SummaryCard diagnostics={fr.diagnostics} expanded={showBySkuDiagnostics} onClick={() => setShowBySkuDiagnostics(v => !v)} dateFrom={dateFrom} dateTo={dateTo} />
        <L3SummaryCard bucketCounts={bucketCounts} triageStatus={fr.triage.status} onClick={scrollToRcaSection} />
      </div>

      {/* L1 drill-down - same fr.bySku data/columns/row handlers as before, just
          relocated out of the compact summary card into its own panel. */}
      {showBySkuFillRate && fr.summary.status === 'done' && (
        <div className={`card ${styles.sectionCard}`}>
          <div className="card-header">
            <span className="card-title"><TrendingUp size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />Order Fill Rate by SKU</span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>SKU Code</th><th>SKU Name</th><th title={ORDER_FILL_RATE_FORMULA}>Order Fill Rate %</th><th>Exception</th></tr></thead>
              <tbody>
                {fr.bySku.status === 'done' && fr.bySku.data.items.map(row => (
                  <tr key={row.skuCode}>
                    <td><button className={styles.skuLink} onClick={() => openSku(row.skuCode)}><code>{row.skuCode}</code></button></td>
                    <td>{row.skuName}</td>
                    <td><span className={`badge ${row.isException ? 'badge-danger' : 'badge-success'}`}>{pct(row.fillRate)}</span></td>
                    <td>{row.isException ? <AlertTriangle size={14} color="var(--color-danger)" /> : <CheckCircle size={14} color="var(--color-success)" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* L2 drill-down - same fr.diagnosticsBySku data/columns/row handlers and the
          same real diagnosticMessage text as before, just relocated. */}
      {showBySkuDiagnostics && fr.diagnostics.status === 'done' && (
        <div className={`card ${styles.sectionCard}`}>
          <div className="card-header">
            <span className="card-title">Diagnostics by SKU</span>
          </div>
          <p className="text-xs text-muted" style={{ marginBottom: 8 }}>{fr.diagnostics.data.diagnosticMessage}</p>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>SKU Code</th><th title="Average Stockout Rate for this SKU across the selected period">Stockout Rate (avg)</th><th title="Average Backorder Rate for this SKU across the selected period">Backorder Rate (avg)</th><th title="Average Days of Supply for this SKU across the selected period">DoS (avg) / trend</th></tr></thead>
              <tbody>
                {fr.diagnosticsBySku.status === 'done' && fr.diagnosticsBySku.data.items.map(row => (
                  <tr key={row.skuCode}>
                    <td><button className={styles.skuLink} onClick={() => openSku(row.skuCode)}><code>{row.skuCode}</code></button></td>
                    <td><span className={`badge ${row.isStockoutException ? 'badge-danger' : 'badge-success'}`}>{pct(row.stockoutRate)}</span></td>
                    <td><span className={`badge ${row.isBackorderException ? 'badge-danger' : 'badge-success'}`}>{pct(row.backorderRate)}</span></td>
                    <td>
                      <div className={styles.dosTrendCell}>
                        <Sparkline points={row.dosTrend} width={90} height={24} />
                        <span className="text-xs">
                          <strong>{avgDos(row.dosTrend)?.toFixed(2) ?? '—'}</strong>
                          <span className="text-muted"> avg &middot; {row.dosTrend[0]?.dos?.toFixed?.(2) ?? '—'} &rarr; {row.dosTrend.at(-1)?.dos?.toFixed?.(2) ?? '—'} trend</span>
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 3 - RCA (Triage-gated) */}
      <div ref={rcaSectionRef} className={`card ${styles.sectionCard}`}>
        <div className="card-header">
          <span className="card-title">Root Cause Analysis (L4/L5)</span>
        </div>
        {fr.triage.status === 'loading' && <LoadingRow label="Loading triage..." />}
        {fr.triage.status === 'unavailable' && <UnavailableRow error={fr.triage.error} />}
        {fr.triage.status === 'done' && (
          <>
            {needsAttentionItems.length > 0 && (
              <div className={styles.needsAttentionNote}>
                <Eye size={14} />
                <span>
                  Needs Attention (no RCA - only runs for "responsible" SKUs): {' '}
                  {needsAttentionItems.map(i => `${i.skuCode} (${i.status})`).join(', ')}
                </span>
              </div>
            )}

            {responsibleItems.length === 0 ? (
              <div className="empty-state"><CheckCircle size={32} /><p>No SKUs marked "responsible" for this period.</p></div>
            ) : (
              <>
                <div className={styles.bucketTabs}>
                  {PRIMARY_CAUSE_BUCKETS.map(b => (
                    <button
                      key={b.key}
                      className={`${styles.bucketTab} ${activeBucket === b.key ? styles.bucketTabActive : ''}`}
                      onClick={() => setActiveBucket(b.key)}
                    >
                      {b.key} <span className="badge badge-default">{bucketCounts[b.key] || 0}</span>
                    </button>
                  ))}
                </div>

                {rcaEntries.length < responsibleItems.length && (
                  <LoadingRow label={`Computing RCA for ${responsibleItems.length - rcaEntries.length} more SKU(s)...`} />
                )}

                <div className="table-container">
                  <table className="data-table">
                    <thead><tr><th>SKU Code</th><th>SKU Name</th><th title={ORDER_FILL_RATE_FORMULA}>Order Fill Rate</th><th>Primary Cause</th><th></th></tr></thead>
                    <tbody>
                      {bucketSkus.map(entry => (
                        <tr key={entry.triage.skuCode}>
                          <td><button className={styles.skuLink} onClick={() => openSku(entry.triage.skuCode)}><code>{entry.triage.skuCode}</code></button></td>
                          <td>{bySkuMap.get(entry.triage.skuCode)?.skuName || entry.triage.skuCode}</td>
                          <td>{pct(entry.triage.fillRate)}</td>
                          <td>{entry.rca.data.primaryCause}</td>
                          <td>
                            <button className="btn btn-secondary btn-sm" onClick={() => setDrawerSku(entry.triage.skuCode)}>
                              Open RCA <ChevronRight size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {bucketSkus.length === 0 && (
                        <tr><td colSpan={5}><div className="empty-state"><p>No SKUs in this bucket for this period.</p></div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Section 4 - Action Cards (consolidated) */}
      <div className={`card ${styles.sectionCard}`}>
        <div className="card-header">
          <span className="card-title">Pending Actions</span>
          <span className="badge badge-warning">{pendingEntries.length} SKU{pendingEntries.length === 1 ? '' : 's'}</span>
        </div>
        {pendingEntries.length === 0 ? (
          <div className="empty-state"><CheckCircle size={32} /><p>Nothing pending - every recommended action for this period has been approved.</p></div>
        ) : (
          <div className={styles.insightList}>
            {pendingEntries.map(entry => (
              <RcaCard
                key={entry.triage.skuCode}
                rca={entry.rca.data}
                driverRow={driverBySku.get(entry.triage.skuCode)}
                skuName={bySkuMap.get(entry.triage.skuCode)?.skuName || entry.triage.skuCode}
                node={node}
                appliedActions={fr.appliedActionsBySku[entry.triage.skuCode] || new Set()}
                onApprove={async (sku, actions, approvedBy) => {
                  const result = await fr.approveActions(sku, actions, approvedBy)
                  showToast(`${sku}: ${actions.join(', ')} approved`, 'success')
                  return result
                }}
                approvedBy={user?.name || 'planner'}
                onOpenSku={openSku}
              />
            ))}
          </div>
        )}
      </div>

      {/* Section 5 - Measurement */}
      <div className={`card ${styles.sectionCard}`}>
        <div className="card-header">
          <span className="card-title">Measurement</span>
        </div>
        {appliedSkus.length === 0 ? (
          <p className="text-xs text-muted">No approved actions yet this session - approve a recommendation above to track before/after Fill Rate here.</p>
        ) : (
          <>
            {appliedSkus.map(sku => <MeasurementStrip key={sku} skuCode={sku} period={measurementPeriod} />)}
            <p className="text-xs text-muted" style={{ marginTop: 8 }}>
              SKUs with no "after" period data yet (period {measurementPeriod.afterFrom} to {measurementPeriod.afterTo}) are omitted here rather than showing a broken comparison.
            </p>
          </>
        )}
      </div>

      <Drawer
        open={Boolean(drawerEntry)}
        onClose={() => setDrawerSku(null)}
        title={drawerEntry ? `${drawerEntry.triage.skuCode} RCA` : ''}
        subtitle={drawerEntry ? bySkuMap.get(drawerEntry.triage.skuCode)?.skuName : ''}
        width={640}
      >
        {drawerEntry && (
          <RcaCard
            rca={drawerEntry.rca.data}
            driverRow={driverBySku.get(drawerEntry.triage.skuCode)}
            skuName={bySkuMap.get(drawerEntry.triage.skuCode)?.skuName || drawerEntry.triage.skuCode}
            node={node}
            appliedActions={fr.appliedActionsBySku[drawerEntry.triage.skuCode] || new Set()}
            onApprove={async (sku, actions, approvedBy) => {
              const result = await fr.approveActions(sku, actions, approvedBy)
              showToast(`${sku}: ${actions.join(', ')} approved`, 'success')
              return result
            }}
            approvedBy={user?.name || 'planner'}
            onOpenSku={openSku}
          />
        )}
      </Drawer>
    </div>
  )
}
