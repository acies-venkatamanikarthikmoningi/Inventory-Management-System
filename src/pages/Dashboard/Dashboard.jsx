import { useState, useEffect, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { useNavigate } from 'react-router-dom'
import {
  Package, BarChart2, AlertTriangle, CheckCircle, TrendingUp,
  TrendingDown, Upload, Activity, RefreshCw, Download,
  ShieldAlert, Archive, Clock, Eye, Zap, FileText
} from 'lucide-react'
import inventoryData from '../../data/inventory.json'
import styles from './Dashboard.module.css'

/* ── Helpers ────────────────────────────────────────── */
const today   = new Date()
const daysUntil = d => Math.ceil((new Date(d) - today) / 86400000)

const totalSKUs         = inventoryData.length
const totalInventory    = inventoryData.reduce((s, i) => s + i.availableQty + i.reservedQty, 0)
const nearExpiry        = inventoryData.filter(i => { const d = daysUntil(i.expiry); return d > 0 && d <= 90 }).length
const lowStock          = inventoryData.filter(i => i.status === 'Low' || i.status === 'Critical').length
const reservedInventory = inventoryData.reduce((s, i) => s + i.reservedQty, 0)
const healthyItems      = inventoryData.filter(i => i.status === 'Healthy').length
const accuracyPct       = Math.round((healthyItems / totalSKUs) * 100)

/* ── Sparkline component (SVG path) ─────────────────── */
function Sparkline({ data, color = '#2563EB', height = 36, width = 80 }) {
  const max   = Math.max(...data)
  const min   = Math.min(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)

  const points = data.map((v, i) => [
    i * stepX,
    height - ((v - min) / range) * (height - 4) - 2
  ])

  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  // Area fill
  const area = `${d} L ${(data.length - 1) * stepX} ${height} L 0 ${height} Z`

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${color.replace('#', '')})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r="2.5"
        fill={color}
      />
    </svg>
  )
}

/* ── Animated counter hook ──────────────────────────── */
function useAnimatedCounter(target, duration = 800) {
  const [value, setValue] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    const start = performance.now()
    const animate = (now) => {
      const elapsed  = now - start
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return value
}

/* ── KPI Card data with sparklines + yesterday comparison ── */
const KPIS = [
  {
    id: 'total-skus',
    label: 'Total SKUs',
    today: totalSKUs, yesterday: totalSKUs - 3,
    icon: Package, color: '#2563EB', bg: '#DBEAFE',
    spark: [12, 14, 13, 15, 14, 16, 15],
    format: v => v.toString(),
  },
  {
    id: 'total-inv',
    label: 'Total Inventory',
    today: totalInventory, yesterday: totalInventory - 850,
    icon: Archive, color: '#0891B2', bg: '#E0F2FE',
    spark: [40000, 41000, 39500, 42000, 41500, 43000, totalInventory],
    format: v => v.toLocaleString(),
  },
  {
    id: 'avail-cap',
    label: 'Available Capacity',
    today: 31500, yesterday: 30800,
    icon: BarChart2, color: '#059669', bg: '#DCFCE7',
    spark: [30000, 31000, 29500, 31500, 30000, 31800, 31500],
    format: v => v.toLocaleString(),
  },
  {
    id: 'near-expiry',
    label: 'Near Expiry Items',
    today: nearExpiry, yesterday: nearExpiry - 1,
    icon: Clock, color: '#D97706', bg: '#FEF3C7',
    spark: [2, 3, 3, 4, 4, 5, nearExpiry],
    format: v => v.toString(),
    invertTrend: true,
  },
  {
    id: 'low-stock',
    label: 'Low Stock Items',
    today: lowStock, yesterday: lowStock + 2,
    icon: AlertTriangle, color: '#DC2626', bg: '#FEE2E2',
    spark: [8, 7, 9, 8, 7, 6, lowStock],
    format: v => v.toString(),
    invertTrend: true,
  },
  {
    id: 'damaged',
    label: 'Damaged Inventory',
    today: 4, yesterday: 5,
    icon: ShieldAlert, color: '#7C3AED', bg: '#EDE9FE',
    spark: [6, 5, 6, 5, 5, 4, 4],
    format: v => v.toString(),
    invertTrend: true,
  },
  {
    id: 'reserved',
    label: 'Reserved Inventory',
    today: reservedInventory, yesterday: reservedInventory + 200,
    icon: Archive, color: '#0284C7', bg: '#E0F2FE',
    spark: [2400, 2500, 2300, 2600, 2500, 2400, reservedInventory],
    format: v => v.toLocaleString(),
  },
  {
    id: 'wh-util',
    label: 'Warehouse Utilization',
    today: 77, yesterday: 74,
    icon: BarChart2, color: '#CA8A04', bg: '#FEF9C3',
    spark: [71, 72, 73, 74, 75, 76, 77],
    format: v => `${v}%`,
    invertTrend: true,
  },
  {
    id: 'inv-accuracy',
    label: 'Inventory Accuracy',
    today: accuracyPct, yesterday: accuracyPct - 1,
    icon: CheckCircle, color: '#16A34A', bg: '#DCFCE7',
    spark: [91, 91, 92, 92, 93, 93, accuracyPct],
    format: v => `${v}%`,
  },
  {
    id: 'recent-uploads',
    label: 'Recent Uploads',
    today: 12, yesterday: 8,
    icon: Upload, color: '#6D28D9', bg: '#EDE9FE',
    spark: [5, 7, 6, 8, 9, 11, 12],
    format: v => v.toString(),
  },
]

/* ── KPI Card component ──────────────────────────────── */
function KPICard({ kpi }) {
  const animVal = useAnimatedCounter(kpi.today)
  const diff    = kpi.today - kpi.yesterday
  const diffPct = Math.abs(Math.round((diff / (kpi.yesterday || 1)) * 100))
  const isUp    = diff > 0
  const isGood  = kpi.invertTrend ? !isUp : isUp

  return (
    <div className={`card ${styles.kpiCard}`}>
      <div className={styles.kpiTopRow}>
        <div className={styles.kpiIconWrap} style={{ background: kpi.bg, color: kpi.color }}>
          <kpi.icon size={17} />
        </div>
        <Sparkline data={kpi.spark} color={kpi.color} />
      </div>
      <div className={styles.kpiValue} style={{ color: kpi.color }}>
        {kpi.format(animVal)}
      </div>
      <div className={styles.kpiLabel}>{kpi.label}</div>
      <div className={styles.kpiTrend}>
        <div className={styles.kpiCompare}>
          <span className={styles.kpiYesterday}>Yesterday: {kpi.format(kpi.yesterday)}</span>
        </div>
        <span className={`${styles.kpiDiff} ${isGood ? styles.trendGood : styles.trendBad}`}>
          {isUp ? <TrendingUp size={11}/> : <TrendingDown size={11}/>}
          {diff > 0 ? '+' : ''}{typeof kpi.today === 'number' && !kpi.format(1).includes('%') ? diff : `${diff}%`} ({diffPct}%)
        </span>
      </div>
    </div>
  )
}

/* ── Recent Activity ─────────────────────────────────── */
const RECENT_ACTIVITY = [
  { id:1, action:'Inventory Count Completed',                user:'Ravi Kumar',   time:'09:45 AM', status:'success', module:'Inventory' },
  { id:2, action:'Batch BATCH-2024-004 flagged near-expiry', user:'System',       time:'09:30 AM', status:'warning', module:'Batch Tracking' },
  { id:3, action:'Data Upload: inventory_jun30.csv',         user:'Fathina Iffat',time:'09:00 AM', status:'success', module:'Data Upload' },
  { id:4, action:'SKU-1007 stock critically low',            user:'System',       time:'08:50 AM', status:'danger',  module:'Insights' },
  { id:5, action:'Replenishment PO-2024-0710 received',      user:'Admin',        time:'08:30 AM', status:'success', module:'Operations' },
  { id:6, action:'Zone 4 capacity at 92%',                   user:'System',       time:'08:00 AM', status:'warning', module:'Capacity' },
  { id:7, action:'SKU Master update: SKU-1006 edited',       user:'Ravi Kumar',   time:'07:30 AM', status:'info',    module:'SKU Master' },
]

const STATUS_MAP = {
  success: { cls:'badge-success', label:'Success' },
  warning: { cls:'badge-warning', label:'Warning' },
  danger:  { cls:'badge-danger',  label:'Alert'   },
  info:    { cls:'badge-primary', label:'Info'    },
}

export default function Dashboard() {
  const { node, showToast } = useApp()
  const navigate = useNavigate()
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => {
      setRefreshing(false)
      showToast('Dashboard refreshed successfully', 'success')
    }, 1200)
  }

  const handleExport = () => {
    showToast('Dashboard report exported (PDF simulation)', 'info')
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h2>Dashboard</h2>
          <p>Overview for <strong>{node}</strong> — {new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleRefresh}>
            <RefreshCw size={14} className={refreshing ? styles.spin : ''} />
            Refresh
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport}>
            <Download size={14} /> Export Report
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/app/data-upload')}>
            <Upload size={14} /> Upload Data
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className={styles.kpiGrid}>
        {KPIS.map(k => <KPICard key={k.id} kpi={k} />)}
      </div>

      {/* Bottom Row */}
      <div className={styles.bottomRow}>
        {/* Recent Activity Table */}
        <div className="card" style={{ flex: 1, overflow: 'hidden' }}>
          <div className="card-header">
            <span className="card-title">
              <Activity size={15} style={{ display:'inline', verticalAlign:'middle', marginRight:6 }} />
              Recent Activity
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => showToast('Full audit log available in Settings', 'info')}>
              View All
            </button>
          </div>
          <div className="table-container" style={{ border:'none' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>User</th>
                  <th>Module</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_ACTIVITY.map(row => (
                  <tr key={row.id}>
                    <td style={{ maxWidth: 240 }}>{row.action}</td>
                    <td className="text-muted text-sm">{row.user}</td>
                    <td><span className="badge badge-default">{row.module}</span></td>
                    <td className="text-muted text-sm">{row.time}</td>
                    <td>
                      <span className={`badge ${STATUS_MAP[row.status].cls}`}>
                        {STATUS_MAP[row.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Actions */}
        <div className={styles.quickActions}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Quick Actions</span>
            </div>
            <div className={styles.actionList}>
              {[
                { label:'Go to Inventory', desc:'Browse all SKUs',        icon:Package,   path:'/app/inventory',  color:'#2563EB' },
                { label:'Go to Upload',    desc:'Import new data',         icon:Upload,    path:'/app/data-upload',color:'#6D28D9' },
                { label:'View Expiry',     desc:'Batch expiry calendar',   icon:Clock,     path:'/app/batches',    color:'#D97706' },
                { label:'View Alerts',     desc:'Active insights',         icon:AlertTriangle,path:'/app/insights',color:'#DC2626' },
                { label:'Capacity Report', desc:'Zone utilization',        icon:BarChart2, path:'/app/capacity',   color:'#16A34A' },
                { label:'Export Report',   desc:'Download summary',        icon:FileText,  path: null,             color:'#0891B2' },
              ].map(a => (
                <button
                  key={a.label}
                  className={styles.actionBtn}
                  onClick={() => a.path ? navigate(a.path) : handleExport()}
                >
                  <div className={styles.actionIcon} style={{ background:`${a.color}15`, color:a.color }}>
                    <a.icon size={16} />
                  </div>
                  <div className={styles.actionText}>
                    <span className={styles.actionLabel}>{a.label}</span>
                    <span className={styles.actionDesc}>{a.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
