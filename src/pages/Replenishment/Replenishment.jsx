import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { ArrowLeftRight, CheckCircle, ChevronDown, ChevronUp, RefreshCw, Search } from 'lucide-react'
import styles from './Replenishment.module.css'

const PARAMETER_DRIFT = [
  {
    id: 'PD-001',
    metric: 'Safety Stock',
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
    calculation: 'Dynamic Max = ADD x (R + L) + SS_enhanced = 210 x (7 + 4.8) + 979 = 2,478 + 979 + 3 buffer = 5,460 cases',
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

const TRANSFER_OPPORTUNITIES = [
  {
    id: 'TR-001',
    sku: 'Thums Up 2L',
    batch: 'B089',
    qty: 1800,
    unit: 'cases',
    source: {
      node: 'Chennai Distribution Center', zone: 'Ambient', area: 'Area B - Beverages',
      location: 'Aisle 03 - Bay 007 - Level 2', spaceFreedM3: 72,
      dailyDemand: 31, demandTrend: 'falling (was 58/day 4 weeks ago)',
      poCount: 8, poWindowWeeks: 8,
      batchExpiry: '2026-09-02', remainingShelfLifeDays: 55,
      daysToConsume: 58.1, willExpireBeforeConsumed: true,
      writeOffValue: 75600,
    },
    destination: {
      node: 'Bangalore Distribution Center', zone: 'Ambient', area: 'Area A - Beverages',
      availableCapacityM3: 124, capacityForCases: 3100,
      dailyDemand: 210, demandTrend: 'rising (was 165/day 4 weeks ago)',
      poCount: 14, poWindowWeeks: 8,
      currentIP: 980, rop: 1680, belowROP: true,
      daysOfSupply: 4.7, stockoutDate: '2026-07-13',
      inTransitQty: 900, inTransitArrival: '2026-07-16', inTransitArrivesAfterStockout: true,
      transferArrival: '2026-07-11', transitDays: 2, arrivesBeforeStockout: true,
    },
    shelfLifeCheck: { remainingToday: 55, transitDays: 2, onArrival: 53, minRequired: 30, ok: true, spareDays: 23 },
    financials: { executionCost: 14400, writeOffAvoided: 75600, netSaving: 61200 },
  },
  {
    id: 'TR-002',
    sku: 'Limca 600ml',
    batch: 'B144',
    qty: 3200,
    unit: 'cases',
    source: {
      node: 'Chennai Distribution Center', zone: 'Ambient', area: 'Area B - Beverages',
      location: 'Aisle 02 - Bay 004 - Level 3', spaceFreedM3: 128,
      dailyDemand: 44, demandTrend: 'stable, no significant trend',
      poCount: 6, poWindowWeeks: 8,
      batchExpiry: '2026-09-08', remainingShelfLifeDays: 61,
      daysToConsume: 72.7, willExpireBeforeConsumed: true,
      writeOffValue: 112000,
      fefoQueue: [
        { batch: 'B112', qty: 400, expiry: '2026-08-18' },
        { batch: 'B133', qty: 600, expiry: '2026-08-25' },
      ],
      fefoQueueTotalQty: 1000,
      daysToReachThisBatch: 22.7,
      totalDaysUntilFullyConsumed: 95.4,
    },
    destination: {
      node: 'Hyderabad Distribution Center', zone: 'Ambient', area: 'Area C - Beverages',
      availableCapacityM3: 210, capacityForCases: null,
      dailyDemand: 380, demandTrend: 'rising (was 290/day 4 weeks ago)',
      poCount: 17, poWindowWeeks: 8,
      currentIP: 2100, rop: 3040, belowROP: true,
      daysOfSupply: 5.5, stockoutDate: '2026-07-14',
      inTransitQty: 0, inTransitArrival: null, noReplenishmentInPipeline: true,
      transferArrival: '2026-07-12', transitDays: 3, arrivesBeforeStockout: true,
    },
    shelfLifeCheck: { remainingToday: 61, transitDays: 3, onArrival: 58, minRequired: 30, ok: true, spareDays: 28 },
    financials: { executionCost: 22400, writeOffAvoided: 112000, netSaving: 89600 },
  },
  {
    id: 'TR-003',
    sku: 'Maaza Mango 200ml',
    batch: 'B201',
    qty: 2600,
    unit: 'cases',
    source: {
      node: 'Chennai Distribution Center', zone: 'Ambient', area: 'Area A - Beverages',
      location: 'Aisle 01 - Bay 002 - Level 1', spaceFreedM3: 104,
      dailyDemand: 28, demandTrend: 'sharply falling (was 95/day 4 weeks ago - post-summer seasonal drop)',
      poCount: 9, poWindowWeeks: 8,
      batchExpiry: '2026-08-20', remainingShelfLifeDays: 43,
      daysToConsume: 92.9, willExpireBeforeConsumed: true,
      writeOffValue: 83200,
      seasonalNote: 'Maaza demand peaks Apr-Jun and falls sharply in July. This is a predictable seasonal pattern and demand will not recover before expiry.',
    },
    destination: {
      node: 'Coimbatore Distribution Center', zone: 'Ambient', area: 'Area B - Beverages',
      availableCapacityM3: 186, capacityForCases: null,
      dailyDemand: 185, demandTrend: 'still elevated - summer demand arrives ~3-4 weeks later than Chennai',
      poCount: 11, poWindowWeeks: 8,
      currentIP: 1480, rop: 2220, belowROP: true,
      daysOfSupply: 8.0, stockoutDate: '2026-07-17',
      inTransitQty: 800, inTransitArrival: '2026-07-14', inTransitArrivesAfterStockout: false,
      inTransitPartialCoverageDays: 4.3, ipAfterInTransitOnly: 2280, stillAtROPAfterInTransit: true,
      transferArrival: null, transitDays: 1,
      totalIPAfterBoth: 4880, daysOfSupplyAfterBoth: 26.4,
    },
    shelfLifeCheck: { remainingToday: 43, transitDays: 1, onArrival: 42, minRequired: 20, ok: true, spareDays: 22 },
    financials: { executionCost: 10400, writeOffAvoided: 83200, netSaving: 72800 },
  },
]

export default function Replenishment() {
  const { showToast } = useApp()
  const [activeTab, setActiveTab] = useState('drift')
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [expanded, setExpanded] = useState(new Set())

  const tabs = [
    { id:'drift', label:'Parameter Drift' },
    { id:'transfers', label:'Inter-DC Transfers' },
  ]
  const metricCodes = { 'Safety Stock':'SS', 'Reorder Point':'ROP', 'Maximum Stock Level':'MAX' }
  const formatNumber = value => Number(value).toLocaleString('en-IN')
  const formatCurrency = value => `INR ${Number(value).toLocaleString('en-IN')}`
  const shortDcName = node => node.replace(' Distribution Center', ' DC')
  const getDriftPriority = item => item.driftDirection === 'down' ? 'Medium' : 'High'
  const getDriftBadgeClass = item => item.driftDirection === 'down' ? 'badge-warning' : 'badge-danger'
  const getTransferArrivalText = item => item.destination.transferArrival || `${item.destination.transitDays} day transit`
  const setTab = tab => {
    setActiveTab(tab)
    setSearch('')
    setPriorityFilter('All')
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (activeTab === 'drift') {
      let data = PARAMETER_DRIFT
      if (q) data = data.filter(i =>
        i.metric.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.node.toLowerCase().includes(q)
      )
      if (priorityFilter !== 'All') data = data.filter(i => getDriftPriority(i) === priorityFilter)
      return [...data].sort((a,b) => Math.abs(b.driftPct) - Math.abs(a.driftPct))
    }

    let data = TRANSFER_OPPORTUNITIES
    if (q) data = data.filter(i =>
      i.sku.toLowerCase().includes(q) ||
      i.batch.toLowerCase().includes(q) ||
      i.source.node.toLowerCase().includes(q) ||
      i.destination.node.toLowerCase().includes(q)
    )
    if (priorityFilter !== 'All') data = data.filter(() => priorityFilter === 'High')
    return [...data].sort((a,b) => b.financials.netSaving - a.financials.netSaving)
  }, [activeTab, search, priorityFilter])

  const toggleExpand = id => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>Replenishment</h2>
          <p>Manage Safety Stock, Reorder Point, and Maximum Stock parameters, and inter-DC transfer opportunities</p>
        </div>
      </div>

      <div className={styles.tabStrip}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`btn btn-secondary ${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ''}`}
            onClick={() => setTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={`card ${styles.filterBar}`}>
        <div className={styles.searchWrap}>
          <Search size={15} style={{ color:'var(--color-text-light)', flexShrink:0 }}/>
          <input
            className={styles.searchInput}
            placeholder={activeTab === 'drift' ? 'Search SKU, metric, node...' : 'Search SKU, batch, source, destination...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span className="text-sm text-muted">Priority:</span>
          <select className="form-select" style={{ width:'auto' }} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            {['All','High','Medium'].map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {activeTab === 'drift' && (
        <div className={styles.insightList}>
          {filtered.length === 0 && (
            <div className="empty-state card">
              <CheckCircle size={40}/><h4>No parameter drift found</h4><p>Try changing your SKU or priority filter.</p>
            </div>
          )}
          {filtered.map(item => {
            const isExpanded = expanded.has(item.id)
            return (
              <div key={item.id} className={`card ${styles.driftCard}`}>
                <div className={styles.insightHeader}>
                  <div className={styles.insightTitle}>
                    <div className={styles.insightIconWrap} style={{ background:'var(--color-info-light)', color:'var(--color-primary-light)' }}>
                      <RefreshCw size={16}/>
                    </div>
                    <div>
                      <div className={styles.insightType}>{item.sku}</div>
                      <div className={styles.nodeText}>{item.node}</div>
                    </div>
                  </div>
                  <div className={styles.insightMeta}>
                    <span className="badge badge-primary">{metricCodes[item.metric]}</span>
                    <span className={`badge ${getDriftBadgeClass(item)} ${styles.driftBadge}`}>
                      {item.driftPct > 0 ? '+' : ''}{item.driftPct.toFixed(1)}%
                    </span>
                    <span className="badge badge-default">Drifting {item.driftingSinceDays}d</span>
                  </div>
                </div>

                <div className={styles.driftCompare}>
                  <div className={styles.driftValue}>
                    <span>Configured in ERP</span>
                    <strong>{formatNumber(item.erpValue)}</strong>
                    <em>{item.unit}</em>
                  </div>
                  <div className={styles.driftArrow}>-&gt;</div>
                  <div className={styles.driftValue}>
                    <span>Platform Calculates</span>
                    <strong>{formatNumber(item.platformValue)}</strong>
                    <em>{item.unit}</em>
                  </div>
                </div>

                <button className={styles.evidenceToggle} onClick={() => toggleExpand(item.id)}>
                  <span>How we identified this</span>
                  {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                </button>

                {isExpanded && (
                  <div className={styles.expandSection}>
                    <div className={styles.evidenceSummary}>
                      {item.poCount} purchase orders reviewed over {item.poWindowWeeks} weeks
                    </div>
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

                {item.calculation && <div className={styles.calcBlock}>{item.calculation}</div>}
                <p className={styles.explanation}>{item.explanation}</p>

                <div className={styles.impactPanel}>
                  <h4>If you update to {formatNumber(item.platformValue)} {item.unit}</h4>
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
                    onClick={() => showToast(`${item.sku} ${item.metric} updated to ${item.platformValue} ${item.unit}`, 'success')}
                  >
                    {item.actionLabel}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => showToast('Calculation details coming soon', 'info')}>
                    View Calculation
                  </button>
                  <span className="text-xs text-muted" style={{ marginLeft:'auto' }}>{item.id}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'transfers' && (
        <div className={styles.insightList}>
          {filtered.length === 0 && (
            <div className="empty-state card">
              <CheckCircle size={40}/><h4>No transfer opportunities found</h4><p>Try changing your SKU or priority filter.</p>
            </div>
          )}
          {filtered.map(item => (
            <div key={item.id} className={`card ${styles.transferCard}`}>
              <div className={styles.transferHeader}>
                <div className={styles.insightTitle}>
                  <div className={styles.insightIconWrap} style={{ background:'var(--color-primary-light)', color:'#fff' }}>
                    <ArrowLeftRight size={16}/>
                  </div>
                  <div>
                    <div className={styles.insightType}>{item.sku}</div>
                    <div className={styles.nodeText}>Batch {item.batch} - {formatNumber(item.qty)} {item.unit} available to transfer</div>
                  </div>
                </div>
                <span className="badge badge-primary">{shortDcName(item.source.node)} -&gt; {shortDcName(item.destination.node)}</span>
              </div>

              <div className={styles.transferGrid}>
                <div className={styles.transferColumn}>
                  <div className={styles.transferColumnHeader}>Source: {item.source.node}</div>
                  <div className={styles.detailList}>
                    <span>{item.source.zone} / {item.source.area}</span>
                    <span>{item.source.location}</span>
                    <strong>{item.source.spaceFreedM3} m3 space freed</strong>
                  </div>
                  <div className={styles.subBlock}>
                    <h4>Why this batch is at risk here</h4>
                    <p>{item.source.poCount} POs in {item.source.poWindowWeeks} weeks</p>
                    <p>{item.source.dailyDemand}/day, {item.source.demandTrend}</p>
                    <p>Expires {item.source.batchExpiry}; {item.source.remainingShelfLifeDays} days shelf life remaining</p>
                    <p>{item.source.daysToConsume} DOS needed vs {item.source.remainingShelfLifeDays} days available</p>
                    {item.source.willExpireBeforeConsumed && (
                      <p className={styles.riskLine}>Write-off risk: {formatCurrency(item.source.writeOffValue)}</p>
                    )}
                    {item.source.fefoQueue && (
                      <div className={styles.fefoBox}>
                        <strong>FEFO queue ahead: {formatNumber(item.source.fefoQueueTotalQty)} cases</strong>
                        {item.source.fefoQueue.map(batch => (
                          <span key={batch.batch}>{batch.batch}: {formatNumber(batch.qty)} cases, exp {batch.expiry}</span>
                        ))}
                        <span>Total consumption horizon: {item.source.totalDaysUntilFullyConsumed} days</span>
                      </div>
                    )}
                    {item.source.seasonalNote && <p className={styles.warnLine}>{item.source.seasonalNote}</p>}
                  </div>
                </div>

                <div className={styles.transferColumn}>
                  <div className={styles.transferColumnHeader}>Destination: {item.destination.node}</div>
                  <div className={styles.detailList}>
                    <span>{item.destination.zone} / {item.destination.area}</span>
                    <strong>{item.destination.availableCapacityM3} m3 available capacity</strong>
                    {item.destination.capacityForCases && <span>Capacity for {formatNumber(item.destination.capacityForCases)} cases</span>}
                  </div>
                  <div className={styles.subBlock}>
                    <h4>Why {item.destination.node} needs this</h4>
                    <p>{item.destination.poCount} POs in {item.destination.poWindowWeeks} weeks</p>
                    <p>{item.destination.dailyDemand}/day, {item.destination.demandTrend}</p>
                    <p className={item.destination.belowROP ? styles.riskLine : undefined}>Current IP {formatNumber(item.destination.currentIP)} vs ROP {formatNumber(item.destination.rop)}</p>
                    <p>DOS: {item.destination.daysOfSupply}; stockout date {item.destination.stockoutDate}</p>
                    {item.destination.noReplenishmentInPipeline && <p className={styles.riskLine}>No replenishment in pipeline</p>}
                    {item.destination.inTransitQty > 0 && (
                      <p className={item.destination.inTransitArrivesAfterStockout ? styles.warnLine : styles.okLine}>
                        In transit: {formatNumber(item.destination.inTransitQty)} cases arriving {item.destination.inTransitArrival}
                      </p>
                    )}
                    {item.destination.inTransitPartialCoverageDays && (
                      <p>In-transit covers {item.destination.inTransitPartialCoverageDays} days; IP after in-transit only {formatNumber(item.destination.ipAfterInTransitOnly)}</p>
                    )}
                    <p className={item.destination.arrivesBeforeStockout || item.destination.transferArrival === null ? styles.okLine : styles.riskLine}>
                      Transfer arrival {getTransferArrivalText(item)} vs stockout {item.destination.stockoutDate}
                    </p>
                    {item.destination.totalIPAfterBoth && (
                      <p>Total IP after pipeline + transfer: {formatNumber(item.destination.totalIPAfterBoth)} ({item.destination.daysOfSupplyAfterBoth} DOS)</p>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.shelfLifeStrip}>
                <strong>Shelf Life Check</strong>
                <span>{item.shelfLifeCheck.remainingToday}d today -&gt; {item.shelfLifeCheck.transitDays}d transit -&gt; {item.shelfLifeCheck.onArrival}d on arrival</span>
                <span>Minimum required: {item.shelfLifeCheck.minRequired}d</span>
                <span className={styles.okLine}>OK, {item.shelfLifeCheck.spareDays} spare days</span>
              </div>

              <div className={styles.financialStrip}>
                <span>Execution cost: {formatCurrency(item.financials.executionCost)}</span>
                <span>Write-off avoided: {formatCurrency(item.financials.writeOffAvoided)}</span>
                <strong className={styles.netSaving}>Net saving: {formatCurrency(item.financials.netSaving)}</strong>
              </div>

              <div className={styles.insightActions}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => showToast(`Transfer of ${item.qty} cases ${item.sku} initiated: ${item.source.node} -> ${item.destination.node}`, 'success')}
                >
                  Initiate Transfer
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => showToast('Transfer details coming soon', 'info')}>
                  View Details
                </button>
                <span className="text-xs text-muted" style={{ marginLeft:'auto' }}>{item.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
