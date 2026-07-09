import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { AlertTriangle, ArrowLeftRight, CheckCircle, Info, Lightbulb, Search, RefreshCw, XCircle, ChevronDown, ChevronUp, MessageSquare, User, Clock } from 'lucide-react'
import styles from './InventoryInsights.module.css'

const ALL_INSIGHTS = [
  { id:'INS-001', type:'Low Stock Alert',     priority:'Critical', severity:'High',   sku:'SKU-1007', impact:'Production halt risk — Disposable Syringes unavailable for dispatch', message:'Disposable Syringes 5ml stock is critically low (20 units). Reorder point: 1000 units.', recommendation:'Raise an emergency purchase order for 5000 units from MediFlow Medical immediately.', status:'Open',        category:'Stock',       assignedTo:'Ravi Kumar', createdAt:'2026-06-30 06:00' },
  { id:'INS-002', type:'Near Expiry Alert',   priority:'High',     severity:'High',   sku:'BATCH-2024-004', impact:'INR 45,000 inventory value at risk of write-off', message:'Insulin Vials batch BATCH-2024-004 expires in 5 days (2026-07-05).', recommendation:'Prioritize dispatch of this batch. Notify sales team for urgent order fulfilment.', status:'Open',        category:'Expiry',      assignedTo:'Priya Singh', createdAt:'2026-06-30 07:00' },
  { id:'INS-003', type:'Near Expiry Alert',   priority:'High',     severity:'Medium', sku:'BATCH-2024-003', impact:'Moderate expiry risk — 20 days to action', message:'Antiseptic Solution batch BATCH-2024-003 expires in ~20 days (2026-07-20).', recommendation:'Issue inter-node transfer to high-consumption node or plan write-off.', status:'In Progress',  category:'Expiry',      assignedTo:'Arjun Das', createdAt:'2026-06-29 15:00' },
  { id:'INS-004', type:'Over Capacity Alert', priority:'High',     severity:'High',   sku:'Zone 4', impact:'Cold chain overflow risk — temperature sensitive inventory may be at risk', message:'Zone 4 (Cold Storage) is at 92% utilization — approaching overflow threshold.', recommendation:'Review cold chain inventory. Identify and dispatch near-expiry items first.', status:'Open',        category:'Capacity',    assignedTo:'Ravi Kumar', createdAt:'2026-06-30 08:00' },
  { id:'INS-005', type:'Low Stock Alert',     priority:'Medium',   severity:'Medium', sku:'SKU-1002', impact:'Patient safety kit replenishment needed within 7 days', message:'Surgical Gloves (L) stock is below minimum level (150 pairs vs min 200 pairs).', recommendation:'Create a replenishment order. Expected lead time: 7 days.', status:'Open',        category:'Stock',       assignedTo:'Fathina', createdAt:'2026-06-30 09:00' },
  { id:'INS-006', type:'Inventory Imbalance', priority:'Medium',   severity:'Medium', sku:'SKU-1006', impact:'Sub-optimal distribution — 3 nodes showing shortage', message:'N95 Respirator Mask stock is concentrated at one location (83% of total). Other nodes show shortage.', recommendation:'Plan inter-node transfer of 1500 units.', status:'Open',        category:'Balance',     assignedTo:'Arjun Das', createdAt:'2026-06-29 10:00' },
  { id:'INS-007', type:'Duplicate SKU',       priority:'Low',      severity:'Low',    sku:'SKU-1001', impact:'Data integrity issue — possible double-counting in reports', message:'SKU-1001 was detected in latest upload — existing SKU code. Upload may create duplicate records.', recommendation:'Review upload file. Map to existing SKU or create variant.', status:'Resolved',     category:'Data',        assignedTo:'System', createdAt:'2026-06-28 11:00' },
  { id:'INS-008', type:'Empty Location',      priority:'Low',      severity:'Low',    sku:'Rack D3', impact:'Unused rack space for 14+ days', message:'Rack D3 - Zone 3 has been empty for 14+ days.', recommendation:'Utilise vacant space for overflow from high-utilization racks.', status:'Open',        category:'Capacity',    assignedTo:'Unassigned', createdAt:'2026-06-25 09:00' },
  { id:'INS-009', type:'Damaged Inventory',   priority:'High',     severity:'High',   sku:'SKU-1003', impact:'Direct inventory loss — write-off required', message:'4 units of Antiseptic Solution flagged as damaged during last cycle count.', recommendation:'Quarantine damaged stock. Initiate damage report and insurance claim process.', status:'In Progress',  category:'Quality',     assignedTo:'Priya Singh', createdAt:'2026-06-29 16:00' },
  { id:'INS-010', type:'Predictive Alert',    priority:'Medium',   severity:'Medium', sku:'SKU-1008', impact:'Anticipated stockout in Q3 if not actioned', message:'Seasonal analysis: Vitamin C demand expected to spike +35% in Q3 based on historical patterns.', recommendation:'Pre-position additional stock. Suggested safety stock: +800 units by July 15.', status:'Open',        category:'AI Forecast', assignedTo:'System', createdAt:'2026-06-30 05:00' },
]

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

const PRIORITY_ORDER = { Critical:0, High:1, Medium:2, Low:3 }
const PRIORITY_COLORS = {
  Critical: { cls:'badge-danger',  icon:XCircle,       color:'var(--color-danger)' },
  High:     { cls:'badge-danger',  icon:AlertTriangle, color:'var(--color-danger)' },
  Medium:   { cls:'badge-warning', icon:AlertTriangle, color:'var(--color-warning)' },
  Low:      { cls:'badge-info',    icon:Info,          color:'var(--color-info)' },
}
const STATUS_COLORS = { Open:'badge-danger', 'In Progress':'badge-warning', Resolved:'badge-success' }
const CATEGORY_OPTIONS = ['All', ...new Set(ALL_INSIGHTS.map(i=>i.category))]

export default function InventoryInsights() {
  const { showToast } = useApp()
  const [insights, setInsights]         = useState(ALL_INSIGHTS)
  const [activeTab, setActiveTab]       = useState('alerts')
  const [search, setSearch]             = useState('')
  const [catFilter, setCatFilter]       = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [expanded, setExpanded]         = useState(new Set())
  const [comments, setComments]         = useState({})
  const [draftComment, setDraftComment] = useState({})

  const tabs = [
    { id:'alerts', label:'Alerts' },
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
    setCatFilter('All')
    setStatusFilter('All')
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

    if (activeTab === 'transfers') {
      let data = TRANSFER_OPPORTUNITIES
      if (q) data = data.filter(i =>
        i.sku.toLowerCase().includes(q) ||
        i.batch.toLowerCase().includes(q) ||
        i.source.node.toLowerCase().includes(q) ||
        i.destination.node.toLowerCase().includes(q)
      )
      if (priorityFilter !== 'All') data = data.filter(() => priorityFilter === 'High')
      return [...data].sort((a,b) => b.financials.netSaving - a.financials.netSaving)
    }

    let data = insights
    if (q) data = data.filter(i =>
      i.type.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      i.message.toLowerCase().includes(q)
    )
    if (catFilter !== 'All')      data = data.filter(i => i.category === catFilter)
    if (statusFilter !== 'All')   data = data.filter(i => i.status   === statusFilter)
    if (priorityFilter !== 'All') data = data.filter(i => i.priority === priorityFilter)
    return [...data].sort((a,b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
  }, [activeTab, insights, search, catFilter, statusFilter, priorityFilter])

  const toggleExpand = id => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const updateStatus = (id, status) => {
    setInsights(prev => prev.map(i => i.id === id ? { ...i, status } : i))
    showToast(`Insight ${id} marked as "${status}"`, status === 'Resolved' ? 'success' : 'info')
  }

  const addComment = id => {
    const text = draftComment[id]?.trim()
    if (!text) return
    setComments(prev => ({
      ...prev,
      [id]: [...(prev[id] || []), { text, time: new Date().toLocaleTimeString(), user:'You' }]
    }))
    setDraftComment(prev => ({ ...prev, [id]: '' }))
    showToast('Comment added', 'success')
  }

  const counts = useMemo(() => {
    if (activeTab === 'drift') {
      return {
        Critical: 0,
        High: PARAMETER_DRIFT.filter(i=>getDriftPriority(i)==='High').length,
        Open: PARAMETER_DRIFT.length,
        Resolved: 0,
      }
    }
    if (activeTab === 'transfers') {
      return {
        Critical: TRANSFER_OPPORTUNITIES.filter(i=>i.destination.stockoutDate <= '2026-07-14').length,
        High: TRANSFER_OPPORTUNITIES.length,
        Open: TRANSFER_OPPORTUNITIES.length,
        Resolved: 0,
      }
    }
    return {
      Critical: insights.filter(i=>i.priority==='Critical'&&i.status!=='Resolved').length,
      High:     insights.filter(i=>i.priority==='High'&&i.status!=='Resolved').length,
      Open:     insights.filter(i=>i.status==='Open').length,
      Resolved: insights.filter(i=>i.status==='Resolved').length,
    }
  }, [activeTab, insights])

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>Inventory Insights</h2>
          <p>Rule-based alerts, exception management and resolution workflow</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => showToast('Insights refreshed', 'info')}>
            <RefreshCw size={14}/> Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom:16 }}>
        {[
          { label:'Critical',      val:counts.Critical,   color:'var(--color-danger)',  bg:'var(--color-danger-light)' },
          { label:'High Priority', val:counts.High,       color:'var(--color-danger)',  bg:'#FEE2E2' },
          { label:'Open Issues',   val:counts.Open,       color:'var(--color-warning)', bg:'var(--color-warning-light)' },
          { label:'Resolved',      val:counts.Resolved,   color:'var(--color-success)', bg:'var(--color-success-light)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign:'center', padding:'16px' }}>
            <div style={{ fontSize:28, fontWeight:800, color:s.color }}>{s.val}</div>
            <div style={{ fontSize:11, color:'var(--color-text-muted)', marginTop:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>{s.label}</div>
          </div>
        ))}
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

      {/* Filters */}
      <div className={`card ${styles.filterBar}`}>
        <div className={styles.searchWrap}>
          <Search size={15} style={{ color:'var(--color-text-light)', flexShrink:0 }}/>
          <input
            className={styles.searchInput}
            placeholder="Search insights..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {(activeTab === 'alerts' ? [
          { label:'Category', val:catFilter,      setter:setCatFilter,      opts:CATEGORY_OPTIONS },
          { label:'Status',   val:statusFilter,   setter:setStatusFilter,   opts:['All','Open','In Progress','Resolved'] },
          { label:'Priority', val:priorityFilter, setter:setPriorityFilter, opts:['All','Critical','High','Medium','Low'] },
        ] : [
          { label:'Priority', val:priorityFilter, setter:setPriorityFilter, opts:['All','High','Medium'] },
        ]).map(f => (
          <div key={f.label} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span className="text-sm text-muted">{f.label}:</span>
            <select className="form-select" style={{ width:'auto' }} value={f.val} onChange={e => f.setter(e.target.value)}>
              {f.opts.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* Insight Cards */}
      {activeTab === 'alerts' && (
      <div className={styles.insightList}>
        {filtered.length === 0 && (
          <div className="empty-state card">
            <CheckCircle size={40}/><h4>No insights found</h4><p>All good! Try changing your filters.</p>
          </div>
        )}
        {filtered.map(ins => {
          const meta      = PRIORITY_COLORS[ins.priority]
          const IconComp  = meta.icon
          const isExpanded = expanded.has(ins.id)
          const insComments = comments[ins.id] || []

          return (
            <div key={ins.id} className={`card ${styles.insightCard} ${ins.status==='Resolved' ? styles.resolved : ''}`}>
              {/* Header row */}
              <div className={styles.insightHeader} onClick={() => toggleExpand(ins.id)}>
                <div className={styles.insightTitle}>
                  <div className={styles.insightIconWrap} style={{ background:`${meta.color}18`, color:meta.color }}>
                    <IconComp size={16}/>
                  </div>
                  <div>
                    <div className={styles.insightType}>{ins.type}</div>
                    <code className={styles.insightSku}>{ins.sku}</code>
                  </div>
                </div>
                <div className={styles.insightMeta}>
                  <span className={`badge ${meta.cls}`}>{ins.priority}</span>
                  <span className={`badge badge-default`}>{ins.severity} Severity</span>
                  <span className={`badge badge-primary`}>{ins.category}</span>
                  <span className={`badge ${STATUS_COLORS[ins.status]}`}>{ins.status}</span>
                  <button className="btn btn-ghost btn-sm" style={{ padding:'2px 6px' }}>
                    {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                  </button>
                </div>
              </div>

              <p className={styles.insightMsg}>{ins.message}</p>

              {/* Expandable section */}
              {isExpanded && (
                <div className={styles.expandSection}>
                  {/* Impact */}
                  <div className={styles.impactBox}>
                    <AlertTriangle size={13} style={{ color:'var(--color-danger)', flexShrink:0 }}/>
                    <div>
                      <strong>Impact: </strong>{ins.impact}
                    </div>
                  </div>

                  {/* Recommendation */}
                  <div className={styles.recommendation}>
                    <Lightbulb size={14} style={{ color:'var(--color-warning)', flexShrink:0, marginTop:1 }}/>
                    <span><strong>Suggested Action: </strong>{ins.recommendation}</span>
                  </div>

                  {/* Meta row */}
                  <div className={styles.metaRow}>
                    <div className={styles.metaItem}>
                      <User size={12}/> Assigned To: <strong>{ins.assignedTo}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <Clock size={12}/> Created: <strong>{ins.createdAt}</strong>
                    </div>
                  </div>

                  {/* Comments */}
                  <div className={styles.commentsSection}>
                    <div className={styles.commentsTitle}>
                      <MessageSquare size={13}/> Comments {insComments.length > 0 && `(${insComments.length})`}
                    </div>
                    {insComments.map((c, ci) => (
                      <div key={ci} className={styles.commentItem}>
                        <div className={styles.commentAvatar}>Y</div>
                        <div className={styles.commentBody}>
                          <div className={styles.commentText}>{c.text}</div>
                          <div className={styles.commentTime}>{c.user} · {c.time}</div>
                        </div>
                      </div>
                    ))}
                    <div className={styles.commentInput}>
                      <input
                        className="form-input"
                        placeholder="Add a comment..."
                        value={draftComment[ins.id] || ''}
                        onChange={e => setDraftComment(p => ({ ...p, [ins.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') addComment(ins.id) }}
                        style={{ padding:'6px 10px', fontSize:12 }}
                      />
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => addComment(ins.id)}
                        disabled={!draftComment[ins.id]?.trim()}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  {ins.status !== 'Resolved' && (
                    <div className={styles.insightActions}>
                      <button className="btn btn-success btn-sm" onClick={() => updateStatus(ins.id, 'Resolved')}>
                        <CheckCircle size={13}/> Mark Resolved
                      </button>
                      {ins.status !== 'In Progress' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => updateStatus(ins.id, 'In Progress')}>
                          Mark Under Review
                        </button>
                      )}
                      <span className="text-xs text-muted" style={{ marginLeft:'auto' }}>{ins.id}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}

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
