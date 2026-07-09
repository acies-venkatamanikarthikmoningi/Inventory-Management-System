import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import styles from './CapacityUtilization.module.css'

/* ── Single-node zone data for Chennai DC ─────────────── */
const INITIAL_ZONES = [
  { id:'Z1', name:'Zone 1 - General Storage', total:10000, used:8000, blocked:500, reserved:1200 },
  { id:'Z2', name:'Zone 2 - PPE Storage',     total:10000, used:7000, blocked:300, reserved:800  },
  { id:'Z3', name:'Zone 3 - Medical',          total:8000,  used:5500, blocked:200, reserved:600  },
  { id:'Z4', name:'Zone 4 - Cold Storage',     total:10000, used:9200, blocked:400, reserved:900  },
  { id:'Z5', name:'Zone 5 - Nutraceuticals',   total:7000,  used:4800, blocked:100, reserved:500  },
]

const RACK_DATA = [
  { rack:'Rack A1', capacity:2000, occupied:1800 },
  { rack:'Rack A2', capacity:2000, occupied:1600 },
  { rack:'Rack B1', capacity:2500, occupied:2000 },
  { rack:'Rack CS1',capacity:3000, occupied:2500 },
  { rack:'Rack G1', capacity:3000, occupied:2200 },
]

function DonutChart({ data, colors }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
          {data.map((_, i) => <Cell key={i} fill={colors[i]} />)}
        </Pie>
        <Tooltip formatter={v => v.toLocaleString()} />
      </PieChart>
    </ResponsiveContainer>
  )
}

function ZoneCapacityBar({ zone }) {
  const { used, blocked, reserved, total } = zone
  const free    = Math.max(0, total - used - blocked - reserved)
  const usedPct = Math.round((used    / total) * 100)
  const blkPct  = Math.round((blocked / total) * 100)
  const resPct  = Math.round((reserved/ total) * 100)
  const frePct  = Math.round((free    / total) * 100)

  return (
    <div className={styles.zoneBar}>
      <div className={styles.zoneBarLabels}>
        <span className={styles.zoneName}>{zone.name.split(' - ')[1] || zone.name}</span>
        <span className={styles.zonePct} style={{ color: usedPct>85?'var(--color-danger)':usedPct>65?'var(--color-warning)':'var(--color-success)' }}>
          {usedPct}% used
        </span>
      </div>
      {/* Stacked progress bar */}
      <div className={styles.stackedBar}>
        <div title={`Used: ${used.toLocaleString()}`}   style={{ width:`${usedPct}%`, background:'#2563EB' }}/>
        <div title={`Reserved: ${reserved.toLocaleString()}`} style={{ width:`${resPct}%`, background:'#D97706' }}/>
        <div title={`Blocked: ${blocked.toLocaleString()}`}   style={{ width:`${blkPct}%`, background:'#9CA3AF' }}/>
        <div title={`Free: ${free.toLocaleString()}`}   style={{ flex:1, background:'#E2E8F0' }}/>
      </div>
      <div className={styles.zoneNums}>
        <span style={{color:'#2563EB'}}>Used: {used.toLocaleString()}</span>
        <span style={{color:'#D97706'}}>Reserved: {reserved.toLocaleString()}</span>
        <span style={{color:'#6B7280'}}>Blocked: {blocked.toLocaleString()}</span>
        <span style={{color:'#22C55E'}}>Free: {free.toLocaleString()}</span>
      </div>
    </div>
  )
}

export default function CapacityUtilization() {
  const { showToast } = useApp()
  const [zones, setZones]         = useState(INITIAL_ZONES)
  const [moveQty, setMoveQty]     = useState(500)
  const [fromZone, setFromZone]   = useState('Z1')
  const [toZone, setToZone]       = useState('Z3')
  const [overflowError, setOverflowError] = useState(null)

  const totalCapacity  = zones.reduce((s,z) => s + z.total, 0)
  const totalUsed      = zones.reduce((s,z) => s + z.used, 0)
  const totalBlocked   = zones.reduce((s,z) => s + z.blocked, 0)
  const totalReserved  = zones.reduce((s,z) => s + z.reserved, 0)
  const totalFree      = totalCapacity - totalUsed - totalBlocked - totalReserved
  const utilPct        = Math.round((totalUsed / totalCapacity) * 100)

  const donutData = [
    { name:'Used',     value: totalUsed     },
    { name:'Reserved', value: totalReserved },
    { name:'Blocked',  value: totalBlocked  },
    { name:'Free',     value: totalFree     },
  ]

  const barData = zones.map(z => ({
    name:     z.name.split(' - ')[1]?.split(' ')[0] || z.name.split(' ')[1],
    Used:     z.used,
    Reserved: z.reserved,
    Blocked:  z.blocked,
    Free:     Math.max(0, z.total - z.used - z.blocked - z.reserved),
  }))

  const handleSimulate = () => {
    const qty  = parseInt(moveQty) || 0
    setOverflowError(null)

    const fromZ = zones.find(z => z.id === fromZone)
    const toZ   = zones.find(z => z.id === toZone)

    if (!fromZ || !toZ) return
    if (fromZ.id === toZ.id) { showToast('Source and destination zones must be different', 'error'); return }
    if (qty <= 0)             { showToast('Enter a valid quantity', 'error'); return }
    if (qty > fromZ.used)     { showToast(`Source zone only has ${fromZ.used.toLocaleString()} units available`, 'error'); return }

    const toFree = toZ.total - toZ.used - toZ.blocked - toZ.reserved
    if (qty > toFree) {
      setOverflowError(`⚠️ Capacity Exceeded — Cannot Allocate ${qty.toLocaleString()} units. ${toZ.name} only has ${toFree.toLocaleString()} free units.`)
      return
    }

    setZones(prev => prev.map(z => {
      if (z.id === fromZone) return { ...z, used: z.used - qty }
      if (z.id === toZone)   return { ...z, used: z.used + qty }
      return z
    }))
    showToast(`Moved ${qty.toLocaleString()} units: ${fromZ.name.split(' - ')[0]} → ${toZ.name.split(' - ')[0]}`, 'success')
  }

  const handleReset = () => {
    setZones(INITIAL_ZONES)
    setOverflowError(null)
    showToast('Simulation reset to original values', 'info')
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>Capacity Utilization</h2>
          <p>Single-node zone capacity analysis and intra-warehouse movement simulation</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleReset}>
            <RefreshCw size={14}/> Reset Simulation
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{ marginBottom:16 }}>
        {[
          { label:'Total Capacity',   val:totalCapacity.toLocaleString(),  color:'#2563EB' },
          { label:'Used Capacity',    val:totalUsed.toLocaleString(),       color:'#D97706' },
          { label:'Free Space',       val:totalFree.toLocaleString(),       color:'#16A34A' },
          { label:'Blocked/Reserved', val:(totalBlocked+totalReserved).toLocaleString(), color:'#6B7280' },
        ].map(k => (
          <div key={k.label} className="card" style={{ textAlign:'center', padding:'20px 16px' }}>
            <div style={{ fontSize:24, fontWeight:800, color:k.color }}>{k.val}</div>
            <div style={{ fontSize:11, color:'var(--color-text-muted)', marginTop:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div className={styles.grid2}>
        {/* Donut */}
        <div className="card">
          <div className="card-header"><span className="card-title">Warehouse Capacity Overview</span></div>
          <DonutChart data={donutData} colors={['#2563EB','#D97706','#9CA3AF','#E2E8F0']} />
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8 }}>
            {donutData.map((d,i) => (
              <div key={d.name} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ width:10, height:10, borderRadius:'50%', background:['#2563EB','#D97706','#9CA3AF','#E2E8F0'][i], flexShrink:0, display:'block' }}/>
                <span style={{ flex:1, fontSize:13 }}>{d.name}</span>
                <span style={{ fontSize:13, fontWeight:600 }}>{d.value.toLocaleString()} ({Math.round((d.value/totalCapacity)*100)}%)</span>
              </div>
            ))}
          </div>
          <div style={{ textAlign:'center', marginTop:12, paddingTop:12, borderTop:'1px solid var(--color-border)' }}>
            <div style={{ fontSize:32, fontWeight:800, color:'var(--color-primary-light)' }}>{utilPct}%</div>
            <div style={{ fontSize:12, color:'var(--color-text-muted)' }}>Warehouse Utilization</div>
          </div>
        </div>

        {/* Bar Chart */}
        <div className="card">
          <div className="card-header"><span className="card-title">Zone-wise Capacity Breakdown</span></div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top:0, right:10, left:0, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)"/>
              <XAxis dataKey="name" tick={{ fontSize:11 }}/>
              <YAxis tick={{ fontSize:11 }} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={v => v.toLocaleString()}/>
              <Legend wrapperStyle={{ fontSize:11 }}/>
              <Bar dataKey="Used"     fill="#2563EB" stackId="a" radius={[0,0,0,0]}/>
              <Bar dataKey="Reserved" fill="#D97706" stackId="a"/>
              <Bar dataKey="Blocked"  fill="#9CA3AF" stackId="a"/>
              <Bar dataKey="Free"     fill="#E2E8F0" stackId="a" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={styles.grid2} style={{ marginTop:16 }}>
        {/* Zone Progress Bars */}
        <div className="card">
          <div className="card-header"><span className="card-title">Zone Utilization (4-Type View)</span></div>
          <div className={styles.stackLegend}>
            {[['#2563EB','Used'],['#D97706','Reserved'],['#9CA3AF','Blocked'],['#E2E8F0','Free']].map(([c,l]) => (
              <div key={l} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background:c }}/>
                {l}
              </div>
            ))}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {zones.map(z => <ZoneCapacityBar key={z.id} zone={z}/>)}
          </div>
        </div>

        {/* Movement Simulation */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Intra-Warehouse Movement Simulation</span>
            <span className="badge badge-info">Zone-Level</span>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom:14 }}>
            Simulate movement of inventory between zones within this warehouse. Overflow is blocked.
          </p>

          {overflowError && (
            <div className={styles.overflowAlert}>
              <AlertTriangle size={16} style={{ flexShrink:0 }}/>
              <span>{overflowError}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">From Zone</label>
            <select className="form-select" value={fromZone} onChange={e=>{ setFromZone(e.target.value); setOverflowError(null) }}>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginTop:10 }}>
            <label className="form-label">To Zone</label>
            <select className="form-select" value={toZone} onChange={e=>{ setToZone(e.target.value); setOverflowError(null) }}>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          {fromZone === toZone && (
            <div className="text-xs text-muted" style={{ marginTop:4, color:'var(--color-danger)' }}>⚠️ Source and destination must differ</div>
          )}
          <div className="form-group" style={{ marginTop:10 }}>
            <label className="form-label">Quantity to Move (units)</label>
            <input
              type="number" className="form-input"
              value={moveQty} min={1} max={50000}
              onChange={e=>{ setMoveQty(e.target.value); setOverflowError(null) }}
            />
            {fromZone && zones.find(z=>z.id===fromZone) && (
              <div className="text-xs text-muted" style={{ marginTop:3 }}>
                Source zone has {zones.find(z=>z.id===fromZone)?.used.toLocaleString()} used units
              </div>
            )}
          </div>
          <button
            className="btn btn-primary"
            style={{ width:'100%', marginTop:14 }}
            onClick={handleSimulate}
            disabled={fromZone === toZone}
          >
            Simulate Movement
          </button>
          <hr className="divider" style={{ margin:'16px 0' }}/>
          <div className="card-header" style={{ padding:'0 0 8px', borderBottom:'none' }}>
            <span className="card-title">Live Zone Summary</span>
          </div>
          {zones.map(z => {
            const pct = Math.round((z.used/z.total)*100)
            return (
              <div key={z.id} style={{ marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                  <span className="text-muted">{z.name.split(' - ')[1] || z.name}</span>
                  <span style={{ fontWeight:600, color:pct>85?'var(--color-danger)':pct>65?'var(--color-warning)':'var(--color-success)' }}>{pct}%</span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width:`${pct}%`, background:pct>85?'var(--color-danger)':pct>65?'var(--color-warning)':'var(--color-success)'}}/>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
