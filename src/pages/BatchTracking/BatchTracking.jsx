import React, { useMemo, useState } from 'react'
import { Search, Calendar, LayoutList, ChevronLeft, ChevronRight, Download, CheckCircle, AlertTriangle, Layers } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import inventoryData from '../../data/inventory.json'
import styles from './BatchTracking.module.css'

const today = new Date()
const daysUntil = d => Math.ceil((new Date(d) - today) / 86400000)

/* ── Enterprise Helpers ─────────────────────────────── */
const parseLocation = (loc) => {
  let bin = loc || ''
  let zone = 'Zone 1'
  let area = 'General Storage'

  if (loc && loc.includes(' - ')) {
    const parts = loc.split(' - ')
    bin = parts[0]
    zone = parts[1]
  } else if (loc && loc.includes('Zone')) {
    const match = loc.match(/Zone \d/)
    if (match) zone = match[0]
    bin = loc.replace(` - ${zone}`, '').replace(zone, '').trim()
  }

  if (zone.includes('1')) area = 'General Storage'
  else if (zone.includes('2')) area = 'PPE Storage'
  else if (zone.includes('3')) area = 'Medical'
  else if (zone.includes('4')) area = 'Cold Storage'
  else if (zone.includes('5')) area = 'Nutraceuticals'

  return { bin, zone, area }
}

const getAverageDailyDemand = (item) => {
  const seed = parseInt(item.skuCode.replace(/\D/g, '')) || 7
  if (item.classification === 'Fast Moving') {
    return 50 + (seed % 80) // 50 to 130
  }
  if (item.classification === 'Medium Moving') {
    return 15 + (seed % 30) // 15 to 45
  }
  return 2 + (seed % 12) // 2 to 14
}

/* ── Batch Timeline ──────────────────────────────────── */
function BatchTimeline({ batch }) {
  const mfg = new Date(batch.mfgDate)
  const exp = new Date(batch.expiry)
  const totalMs = exp - mfg
  const elapsedMs = today - mfg
  const pct = Math.min(Math.max((elapsedMs / totalMs) * 100, 0), 100)
  const days = batch.daysRemaining

  const steps = [
    { label: 'Manufactured', date: batch.mfgDate, done: true },
    { label: 'Quality Check', date: batch.mfgDate, done: true },
    { label: 'Stored in WH', date: batch.mfgDate, done: true },
    { label: 'Current Age', date: new Date().toISOString().split('T')[0], done: true, active: true },
    { label: 'Expiry', date: batch.expiry, done: days <= 0, danger: batch.risk === 'High Risk' },
  ]

  return (
    <div className={styles.timeline}>
      <div className={styles.timelineSteps}>
        {steps.map((s, i) => (
          <div key={i} className={`${styles.timelineStep} ${s.active ? styles.stepActive : ''} ${s.danger && !s.done ? styles.stepDanger : ''} ${s.done ? styles.stepDone : ''}`}>
            <div className={styles.stepDot}>{s.done && <span>✓</span>}</div>
            {i < steps.length - 1 && (
              <div className={styles.stepLine} style={{ background: steps[i+1].done || steps[i+1].active ? 'var(--color-primary-light)' : 'var(--color-border)' }} />
            )}
            <div className={styles.stepLabel}>{s.label}</div>
            <div className={styles.stepDate}>{s.date}</div>
          </div>
        ))}
      </div>
      <div className={styles.progressSection}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 5 }}>
          <span>Age: {Math.round(elapsedMs / 86400000)} days</span>
          <span>{days <= 0 ? 'Expired' : `${days} days remaining`}</span>
        </div>
        <div className="progress-bar-container" style={{ height: 10 }}>
          <div className="progress-bar-fill" style={{
            width: `${pct}%`,
            background: batch.riskColor,
            borderRadius: 6,
          }} />
        </div>
      </div>
    </div>
  )
}

/* ── Calendar View ───────────────────────────────────── */
function CalendarView({ batches, onSelectBatch }) {
  const [curDate, setCurDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))

  const year = curDate.getFullYear()
  const month = curDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Map expiry dates to batches for this month
  const expiryMap = useMemo(() => {
    const map = {}
    batches.forEach(b => {
      const d = new Date(b.expiry)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        if (!map[day]) map[day] = []
        map[day].push(b)
      }
    })
    return map
  }, [batches, year, month])

  const prevMonth = () => setCurDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurDate(new Date(year, month + 1, 1))

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className={styles.calendar}>
      <div className={styles.calHeader}>
        <button className="btn btn-ghost btn-sm" onClick={prevMonth}><ChevronLeft size={16} /></button>
        <h3 className={styles.calTitle}>{MONTH_NAMES[month]} {year}</h3>
        <button className="btn btn-ghost btn-sm" onClick={nextMonth}><ChevronRight size={16} /></button>
      </div>
      <div className={styles.calGrid}>
        {DAY_NAMES.map(d => (
          <div key={d} className={styles.calDayName}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className={styles.calCell} />
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          const batchesOnDay = expiryMap[day] || []

          return (
            <div
              key={day}
              className={`${styles.calCell} ${isToday ? styles.calToday : ''} ${batchesOnDay.length > 0 ? styles.calHasEvent : ''}`}
              onClick={() => batchesOnDay.length > 0 && onSelectBatch(batchesOnDay[0])}
            >
              <span className={styles.calDayNum}>{day}</span>
              {batchesOnDay.length > 0 && (
                <div className={styles.calDots}>
                  {batchesOnDay.slice(0, 3).map((b, j) => (
                    <span key={j} className={styles.calDot} style={{ background: b.riskColor }} />
                  ))}
                  {batchesOnDay.length > 3 && <span className={styles.calMore}>+{batchesOnDay.length - 3}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Main Component ─────────────────────────────────── */
export default function BatchTracking() {
  const { node } = useApp()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [viewMode, setViewMode] = useState('table') // 'table' | 'calendar'
  const [expandedId, setExpandedId] = useState(null)
  const [calBatch, setCalBatch] = useState(null)

  // Advanced Date Filters states
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [filterDateType, setFilterDateType] = useState('expiry')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [quickShelfLife, setQuickShelfLife] = useState('all')
  const [appliedFilters, setAppliedFilters] = useState({
    dateType: 'expiry',
    fromDate: '',
    toDate: '',
    quickShelfLife: 'all'
  })

  // Pagination states
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const applyAdvancedFilters = () => {
    setAppliedFilters({
      dateType: filterDateType,
      fromDate,
      toDate,
      quickShelfLife
    })
    setPage(1)
    setShowDateFilter(false)
  }

  const clearAllFilters = () => {
    setFromDate('')
    setToDate('')
    setQuickShelfLife('all')
    setAppliedFilters({
      dateType: 'expiry',
      fromDate: '',
      toDate: '',
      quickShelfLife: 'all'
    })
    setPage(1)
  }

  const clearDateRange = () => {
    setFromDate('')
    setToDate('')
    setAppliedFilters(prev => ({
      ...prev,
      fromDate: '',
      toDate: ''
    }))
    setPage(1)
  }

  const clearQuick = () => {
    setQuickShelfLife('all')
    setAppliedFilters(prev => ({
      ...prev,
      quickShelfLife: 'all'
    }))
    setPage(1)
  }

  const activeChips = useMemo(() => {
    const chips = []
    if (appliedFilters.fromDate || appliedFilters.toDate) {
      const label = `${appliedFilters.dateType === 'expiry' ? 'Expiry' : 'Mfg'}: ${appliedFilters.fromDate || '*'} to ${appliedFilters.toDate || '*'}`
      chips.push({ key: 'dateRange', label, clear: clearDateRange })
    }
    if (appliedFilters.quickShelfLife !== 'all') {
      const labelMap = {
        '30': 'Expiring in 30 Days',
        '60': 'Expiring in 60 Days',
        '90': 'Expiring in 90 Days',
        'expired': 'Already Expired'
      }
      chips.push({ key: 'quick', label: labelMap[appliedFilters.quickShelfLife], clear: clearQuick })
    }
    return chips
  }, [appliedFilters])

  const activeNodeName = node || 'Chennai Distribution Center'

  const dbNodeMap = useMemo(() => ({
    'Mumbai Distribution Center': 'Mumbai Distribution Center',
    'Pune Distribution Center': 'Pune Warehouse',
    'Hyderabad Distribution Center': 'Hyderabad Plant',
    'Bangalore Distribution Center': 'Bangalore Distribution Center',
    'Chennai Distribution Center': 'Chennai Distribution Center',
  }), [])

  const targetNode = dbNodeMap[activeNodeName] || activeNodeName

  // Compute metrics and format data for the active Working Node
  const nodeBatches = useMemo(() => {
    return inventoryData
      .filter(item => item.node === targetNode)
      .map(item => {
        const locParts = parseLocation(item.location)
        const daysRemaining = daysUntil(item.expiry)
        const totalMs = new Date(item.expiry) - new Date(item.mfgDate)
        const elapsedMs = today - new Date(item.mfgDate)
        
        // Calculate % shelf life consumed
        const pctConsumed = totalMs > 0 
          ? Math.min(Math.max(Math.round((elapsedMs / totalMs) * 100), 0), 100)
          : 100
        
        // Risk classification rules
        let risk = 'Healthy'
        let riskColor = '#22C55E' // Green
        let riskCls = 'badge-success'
        if (pctConsumed > 85 || daysRemaining <= 30) {
          risk = 'High Risk'
          riskColor = '#EF4444' // Red
          riskCls = 'badge-danger'
        } else if (pctConsumed > 60 || daysRemaining <= 180) {
          risk = 'Medium Risk'
          riskColor = '#F59E0B' // Amber
          riskCls = 'badge-warning'
        }

        const totalShelfLifeDays = Math.round(totalMs / 86400000)
        const minShelfLifeReceipt = Math.round(totalShelfLifeDays * 0.6)

        return {
          ...item,
          ...locParts,
          daysRemaining,
          pctConsumed,
          risk,
          riskColor,
          riskCls,
          totalShelfLifeDays,
          minShelfLifeReceipt,
          averageDailyDemand: getAverageDailyDemand(item)
        }
      })
  }, [targetNode])

  // Filtered dataset based on search queries and risk tab selections
  const filtered = useMemo(() => {
    let data = nodeBatches
    const q = search.toLowerCase()
    if (q) {
      data = data.filter(b =>
        b.batch.toLowerCase().includes(q) ||
        b.skuCode.toLowerCase().includes(q) ||
        b.skuName.toLowerCase().includes(q)
      )
    }
    if (filter !== 'All') {
      data = data.filter(b => b.risk === filter)
    }

    // Advanced Custom Date Range Filter
    if (appliedFilters.fromDate || appliedFilters.toDate) {
      const dateProp = appliedFilters.dateType === 'expiry' ? 'expiry' : 'mfgDate'
      data = data.filter(b => {
        const val = b[dateProp]
        if (appliedFilters.fromDate && val < appliedFilters.fromDate) return false
        if (appliedFilters.toDate && val > appliedFilters.toDate) return false
        return true
      })
    }

    // Quick Shelf Life Expiry Filter
    if (appliedFilters.quickShelfLife !== 'all') {
      data = data.filter(b => {
        const days = b.daysRemaining
        if (appliedFilters.quickShelfLife === '30') return days > 0 && days <= 30
        if (appliedFilters.quickShelfLife === '60') return days > 0 && days <= 60
        if (appliedFilters.quickShelfLife === '90') return days > 0 && days <= 90
        if (appliedFilters.quickShelfLife === 'expired') return days <= 0
        return true
      })
    }

    return data
  }, [nodeBatches, search, filter, appliedFilters])

  // Summary counts for batch-focused KPIs
  const counts = useMemo(() => ({
    total: nodeBatches.length,
    healthy: nodeBatches.filter(b => b.risk === 'Healthy').length,
    medium: nodeBatches.filter(b => b.risk === 'Medium Risk').length,
    high: nodeBatches.filter(b => b.risk === 'High Risk').length,
  }), [nodeBatches])

  // Pagination processing
  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = useMemo(() => {
    return filtered.slice((page - 1) * pageSize, page * pageSize)
  }, [filtered, page, pageSize])

  const handleFilterClick = (riskType) => {
    setFilter(riskType)
    setPage(1)
  }

  // Export filtered batch tracking records to CSV
  const handleExportCSV = () => {
    const headers = [
      'Batch ID', 'SKU Code', 'SKU Description', 'Manufacturing Date', 'Expiry Date',
      'Total Shelf Life (Days)', 'Remaining Shelf Life (Days)', '% Shelf Life Consumed',
      'Min Shelf Life at Receipt (Days)', 'Risk Classification', 'Available Quantity',
      'Storage Location', 'Full Bin Address', 'Average Daily Demand'
    ]
    const rows = filtered.map(b => [
      b.batch, b.skuCode, b.skuName, b.mfgDate, b.expiry,
      b.totalShelfLifeDays, b.daysRemaining, `${b.pctConsumed}%`,
      b.minShelfLifeReceipt, b.risk, b.availableQty,
      b.area, `${b.zone} ➔ ${b.area} ➔ ${b.bin}`, b.averageDailyDemand
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch_tracking_${targetNode.replace(/\s+/g, '_').toLowerCase()}.csv`
    a.click()
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h2>Batch Tracking</h2>
          <p>Monitor batch shelf life, timelines and risk metrics for <strong>{activeNodeName}</strong></p>
        </div>
        <div className="page-header-actions" style={{ gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>
            <Download size={14} /> Export ({filtered.length})
          </button>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${viewMode === 'table' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('table')}
            >
              <LayoutList size={14} /> Table
            </button>
            <button
              className={`${styles.viewBtn} ${viewMode === 'calendar' ? styles.viewBtnActive : ''}`}
              onClick={() => setViewMode('calendar')}
            >
              <Calendar size={14} /> Calendar
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid-4" style={{ marginBottom: 16 }}>
        {[
          { label: 'Total Active Batches', count: counts.total, color: 'var(--color-primary-light)', bg: 'var(--color-info-light)', icon: Layers },
          { label: 'Healthy Batches', count: counts.healthy, color: 'var(--color-success)', bg: 'var(--color-success-light)', icon: CheckCircle },
          { label: 'Medium Risk Batches', count: counts.medium, color: 'var(--color-warning)', bg: 'var(--color-warning-light)', icon: AlertTriangle },
          { label: 'High Risk Batches', count: counts.high, color: 'var(--color-danger)', bg: 'var(--color-danger-light)', icon: AlertTriangle },
        ].map(s => {
          const Icon = s.icon
          return (
            <div
              key={s.label}
              className="card"
              style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', cursor: 'pointer', transition: 'transform 0.15s' }}
              onClick={() => {
                if (s.label.includes('Total')) handleFilterClick('All')
                else if (s.label.includes('Healthy')) handleFilterClick('Healthy')
                else if (s.label.includes('Medium')) handleFilterClick('Medium Risk')
                else if (s.label.includes('High')) handleFilterClick('High Risk')
              }}
            >
              <div style={{ width: 48, height: 48, borderRadius: 12, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={20} style={{ color: s.color }} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-text)' }}>{s.count}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>{s.label}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Search + Filter Panel (Table Mode) */}
      {viewMode === 'table' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <Search size={15} style={{ color: 'var(--color-text-light)', flexShrink: 0 }} />
            <input
              className={styles.searchInput}
              placeholder="Search batch ID, SKU code, SKU description..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
            <div className={styles.filterTabs}>
              {[
                { label: 'All', value: 'All' },
                { label: 'Healthy', value: 'Healthy' },
                { label: 'Medium Risk', value: 'Medium Risk' },
                { label: 'High Risk', value: 'High Risk' }
              ].map(f => (
                <button
                  key={f.value}
                  className={`${styles.filterTab} ${filter === f.value ? styles.filterTabActive : ''}`}
                  onClick={() => handleFilterClick(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              className={`btn btn-secondary btn-sm ${showDateFilter ? styles.filterActiveBtn : ''}`}
              onClick={() => setShowDateFilter(p => !p)}
            >
              <Calendar size={14} /> Date Filters
              {activeChips.length > 0 && <span className={styles.filterBadge}>{activeChips.length}</span>}
            </button>
          </div>

          {/* Active Chips Row */}
          {activeChips.length > 0 && (
            <div className={styles.chipRow}>
              {activeChips.map(chip => (
                <button key={chip.key} className={styles.chip} onClick={chip.clear}>
                  {chip.label} <span className={styles.chipX}>×</span>
                </button>
              ))}
              <button className="btn btn-ghost btn-xs" style={{ fontSize: 11, padding: '2px 8px' }} onClick={clearAllFilters}>
                Clear All
              </button>
            </div>
          )}

          {/* Advanced Date & Shelf Life Filters Panel */}
          {showDateFilter && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                {/* Date Target Dropdown */}
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: 11, display: 'block', marginBottom: 6, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter Target Date</label>
                  <select
                    className="form-select"
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    value={filterDateType}
                    onChange={e => setFilterDateType(e.target.value)}
                  >
                    <option value="expiry">Expiry Date</option>
                    <option value="mfg">Manufacturing Date</option>
                  </select>
                </div>

                {/* From Date */}
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: 11, display: 'block', marginBottom: 6, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From Date</label>
                  <input
                    type="date"
                    className="form-input"
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                  />
                </div>

                {/* To Date */}
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: 11, display: 'block', marginBottom: 6, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To Date</label>
                  <input
                    type="date"
                    className="form-input"
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                  />
                </div>

                {/* Quick Expiry Filters */}
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: 11, display: 'block', marginBottom: 6, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick Expiry Monitor</label>
                  <select
                    className="form-select"
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    value={quickShelfLife}
                    onChange={e => setQuickShelfLife(e.target.value)}
                  >
                    <option value="all">All Batches</option>
                    <option value="30">Expiring in 30 Days</option>
                    <option value="60">Expiring in 60 Days</option>
                    <option value="90">Expiring in 90 Days</option>
                    <option value="expired">Already Expired</option>
                  </select>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={clearAllFilters}
                >
                  Reset Filters
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={applyAdvancedFilters}
                >
                  Apply Filters
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
          <CalendarView batches={nodeBatches} onSelectBatch={setCalBatch} />
          <div className="card">
            <div className="card-header"><span className="card-title">Batch Shelf-Life Summary</span></div>
            {calBatch ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <code style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--color-surface-hover)', padding: '3px 8px', borderRadius: 4, color: 'var(--color-primary-light)', fontWeight: 600 }}>
                    {calBatch.batch}
                  </code>
                  <div style={{ fontWeight: 600, fontSize: 14, marginTop: 6, color: 'var(--color-text)' }}>{calBatch.skuName}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{calBatch.skuCode}</div>
                </div>
                {[
                  ['Brand', calBatch.brand],
                  ['Mfg Date', calBatch.mfgDate],
                  ['Expiry Date', calBatch.expiry],
                  ['Total Shelf Life', `${calBatch.shelfLife} Months`],
                  ['Remaining Shelf Life', `${calBatch.daysRemaining} days`],
                  ['Min Shelf Life Receipt', `${calBatch.minShelfLifeReceipt} days`],
                  ['Risk Classification', <span className={`badge ${calBatch.riskCls}`}>{calBatch.risk}</span>],
                  ['Available Quantity', calBatch.availableQty.toLocaleString()],
                  ['Location', calBatch.area],
                  ['Daily Demand', `${calBatch.averageDailyDemand} Units`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{k}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>{v}</span>
                  </div>
                ))}
                <BatchTimeline batch={calBatch} />
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '32px 16px' }}>
                <Calendar size={28} />
                <p>Select a date containing expiry events to monitor specific batch timelines</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-container" style={{ overflowY: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Batch ID</th>
                  <th>SKU Code</th>
                  <th>SKU Description</th>
                  <th>Mfg Date</th>
                  <th>Expiry Date</th>
                  <th>Total Shelf Life</th>
                  <th>Remaining Shelf Life</th>
                  <th>% Shelf Life Consumed</th>
                  <th>Min Shelf Life Receipt</th>
                  <th>Risk Classification</th>
                  <th>Available Quantity</th>
                  <th>Storage Location</th>
                  <th>Full Bin Address</th>
                  <th>Avg Daily Demand</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={15}>
                      <div className="empty-state" style={{ padding: 48 }}>
                        <Search size={32} />
                        <h4>No batches found</h4>
                        <p>No batches match the search filters for the selected node.</p>
                      </div>
                    </td>
                  </tr>
                ) : paged.map(b => (
                  <React.Fragment key={b.id}>
                    <tr
                      style={{ background: b.daysRemaining <= 0 ? 'rgba(239,68,68,0.03)' : b.risk === 'High Risk' ? 'rgba(239,68,68,0.02)' : '' }}
                      className={styles.tableRow}
                      onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                    >
                      <td onClick={e => e.stopPropagation()}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                          style={{ padding: '2px 6px', fontSize: 10 }}
                        >
                          {expandedId === b.id ? '▼' : '▶'}
                        </button>
                      </td>
                      <td>
                        <code style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--color-surface-hover)', padding: '2px 6px', borderRadius: 4, color: 'var(--color-primary-light)', fontWeight: 600 }}>
                          {b.batch}
                        </code>
                      </td>
                      <td className="text-sm text-muted"><code>{b.skuCode}</code></td>
                      <td style={{ minWidth: 160 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>{b.skuName}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{b.brand}</div>
                      </td>
                      <td className="text-sm">{b.mfgDate}</td>
                      <td className="text-sm">{b.expiry}</td>
                      <td className="text-sm">{b.totalShelfLifeDays} days <span className="text-muted">({b.shelfLife}m)</span></td>
                      <td className="text-sm font-semibold" style={{ color: b.riskColor }}>
                        {b.daysRemaining <= 0 ? '0 days (Expired)' : `${b.daysRemaining} days`}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="progress-bar-container" style={{ width: 80, height: 6 }}>
                            <div className="progress-bar-fill" style={{
                              width: `${b.pctConsumed}%`,
                              background: b.riskColor
                            }} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', minWidth: 30 }}>{b.pctConsumed}%</span>
                        </div>
                      </td>
                      <td className="text-sm text-muted">{b.minShelfLifeReceipt} days</td>
                      <td><span className={`badge ${b.riskCls}`}>{b.risk}</span></td>
                      <td><strong>{b.availableQty.toLocaleString()}</strong></td>
                      <td className="text-sm">{b.area}</td>
                      <td className="text-sm text-muted" style={{ whiteSpace: 'nowrap' }}>
                        {b.zone} ➔ {b.area} ➔ {b.bin}
                      </td>
                      <td className="text-sm"><strong>{b.averageDailyDemand}</strong> units/day</td>
                    </tr>
                    {expandedId === b.id && (
                      <tr key={`${b.id}-exp`}>
                        <td colSpan={15} style={{ padding: '16px 20px', background: 'var(--color-surface-hover)' }}>
                          <div style={{ maxWidth: 680 }}>
                            <h4 style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Batch Timeline Detail</h4>
                            <BatchTimeline batch={b} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className={styles.paginationBar}>
              <span className="text-sm text-muted">
                Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
              </span>
              <div className="pagination">
                <button className="pagination-btn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
                <button className="pagination-btn" onClick={() => setPage(p => p - 1)} disabled={page === 1}>‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i
                  return <button key={p} className={`pagination-btn ${p === page ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
                })}
                <button className="pagination-btn" onClick={() => setPage(p => p + 1)} disabled={page === totalPages || totalPages === 0}>›</button>
                <button className="pagination-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages || totalPages === 0}>»</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
