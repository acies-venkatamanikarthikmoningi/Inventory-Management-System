import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { AlertTriangle, CheckCircle, Info, Lightbulb, Search, RefreshCw, XCircle, ChevronDown, ChevronUp, MessageSquare, User, Clock } from 'lucide-react'
import styles from './InventoryInsights.module.css'

const ALL_INSIGHTS = [
  { id:'INS-001', type:'Low Stock Alert',     priority:'Critical', severity:'High',   sku:'SKU-1007', impact:'Production halt risk â€” Disposable Syringes unavailable for dispatch', message:'Disposable Syringes 5ml stock is critically low (20 units). Reorder point: 1000 units.', recommendation:'Raise an emergency purchase order for 5000 units from MediFlow Medical immediately.', status:'Open',        category:'Stock',       assignedTo:'Ravi Kumar', createdAt:'2026-06-30 06:00' },
  { id:'INS-002', type:'Near Expiry Alert',   priority:'High',     severity:'High',   sku:'BATCH-2024-004', impact:'INR 45,000 inventory value at risk of write-off', message:'Insulin Vials batch BATCH-2024-004 expires in 5 days (2026-07-05).', recommendation:'Prioritize dispatch of this batch. Notify sales team for urgent order fulfilment.', status:'Open',        category:'Expiry',      assignedTo:'Priya Singh', createdAt:'2026-06-30 07:00' },
  { id:'INS-003', type:'Near Expiry Alert',   priority:'High',     severity:'Medium', sku:'BATCH-2024-003', impact:'Moderate expiry risk â€” 20 days to action', message:'Antiseptic Solution batch BATCH-2024-003 expires in ~20 days (2026-07-20).', recommendation:'Issue inter-node transfer to high-consumption node or plan write-off.', status:'In Progress',  category:'Expiry',      assignedTo:'Arjun Das', createdAt:'2026-06-29 15:00' },
  { id:'INS-004', type:'Over Capacity Alert', priority:'High',     severity:'High',   sku:'Zone 4', impact:'Cold chain overflow risk â€” temperature sensitive inventory may be at risk', message:'Zone 4 (Cold Storage) is at 92% utilization â€” approaching overflow threshold.', recommendation:'Review cold chain inventory. Identify and dispatch near-expiry items first.', status:'Open',        category:'Capacity',    assignedTo:'Ravi Kumar', createdAt:'2026-06-30 08:00' },
  { id:'INS-005', type:'Low Stock Alert',     priority:'Medium',   severity:'Medium', sku:'SKU-1002', impact:'Patient safety kit replenishment needed within 7 days', message:'Surgical Gloves (L) stock is below minimum level (150 pairs vs min 200 pairs).', recommendation:'Create a replenishment order. Expected lead time: 7 days.', status:'Open',        category:'Stock',       assignedTo:'Fathina', createdAt:'2026-06-30 09:00' },
  { id:'INS-006', type:'Inventory Imbalance', priority:'Medium',   severity:'Medium', sku:'SKU-1006', impact:'Sub-optimal distribution â€” 3 nodes showing shortage', message:'N95 Respirator Mask stock is concentrated at one location (83% of total). Other nodes show shortage.', recommendation:'Plan inter-node transfer of 1500 units.', status:'Open',        category:'Balance',     assignedTo:'Arjun Das', createdAt:'2026-06-29 10:00' },
  { id:'INS-007', type:'Duplicate SKU',       priority:'Low',      severity:'Low',    sku:'SKU-1001', impact:'Data integrity issue â€” possible double-counting in reports', message:'SKU-1001 was detected in latest upload â€” existing SKU code. Upload may create duplicate records.', recommendation:'Review upload file. Map to existing SKU or create variant.', status:'Resolved',     category:'Data',        assignedTo:'System', createdAt:'2026-06-28 11:00' },
  { id:'INS-008', type:'Empty Location',      priority:'Low',      severity:'Low',    sku:'Rack D3', impact:'Unused rack space for 14+ days', message:'Rack D3 - Zone 3 has been empty for 14+ days.', recommendation:'Utilise vacant space for overflow from high-utilization racks.', status:'Open',        category:'Capacity',    assignedTo:'Unassigned', createdAt:'2026-06-25 09:00' },
  { id:'INS-009', type:'Damaged Inventory',   priority:'High',     severity:'High',   sku:'SKU-1003', impact:'Direct inventory loss â€” write-off required', message:'4 units of Antiseptic Solution flagged as damaged during last cycle count.', recommendation:'Quarantine damaged stock. Initiate damage report and insurance claim process.', status:'In Progress',  category:'Quality',     assignedTo:'Priya Singh', createdAt:'2026-06-29 16:00' },
  { id:'INS-010', type:'Predictive Alert',    priority:'Medium',   severity:'Medium', sku:'SKU-1008', impact:'Anticipated stockout in Q3 if not actioned', message:'Seasonal analysis: Vitamin C demand expected to spike +35% in Q3 based on historical patterns.', recommendation:'Pre-position additional stock. Suggested safety stock: +800 units by July 15.', status:'Open',        category:'AI Forecast', assignedTo:'System', createdAt:'2026-06-30 05:00' },
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
  const [search, setSearch]             = useState('')
  const [catFilter, setCatFilter]       = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [expanded, setExpanded]         = useState(new Set())
  const [comments, setComments]         = useState({})
  const [draftComment, setDraftComment] = useState({})

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
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
  }, [insights, search, catFilter, statusFilter, priorityFilter])

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

  const counts = useMemo(() => ({
    Critical: insights.filter(i=>i.priority==='Critical'&&i.status!=='Resolved').length,
    High:     insights.filter(i=>i.priority==='High'&&i.status!=='Resolved').length,
    Open:     insights.filter(i=>i.status==='Open').length,
    Resolved: insights.filter(i=>i.status==='Resolved').length,
  }), [insights])

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

      <div className="grid-4" style={{ marginBottom:16 }}>
        {[
          { label:'Critical',      val:counts.Critical,   color:'var(--color-danger)' },
          { label:'High Priority', val:counts.High,       color:'var(--color-danger)' },
          { label:'Open Issues',   val:counts.Open,       color:'var(--color-warning)' },
          { label:'Resolved',      val:counts.Resolved,   color:'var(--color-success)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign:'center', padding:'16px' }}>
            <div style={{ fontSize:28, fontWeight:800, color:s.color }}>{s.val}</div>
            <div style={{ fontSize:11, color:'var(--color-text-muted)', marginTop:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>{s.label}</div>
          </div>
        ))}
      </div>

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
        {[
          { label:'Category', val:catFilter,      setter:setCatFilter,      opts:CATEGORY_OPTIONS },
          { label:'Status',   val:statusFilter,   setter:setStatusFilter,   opts:['All','Open','In Progress','Resolved'] },
          { label:'Priority', val:priorityFilter, setter:setPriorityFilter, opts:['All','Critical','High','Medium','Low'] },
        ].map(f => (
          <div key={f.label} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span className="text-sm text-muted">{f.label}:</span>
            <select className="form-select" style={{ width:'auto' }} value={f.val} onChange={e => f.setter(e.target.value)}>
              {f.opts.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className={styles.insightList}>
        {filtered.length === 0 && (
          <div className="empty-state card">
            <CheckCircle size={40}/><h4>No insights found</h4><p>All good! Try changing your filters.</p>
          </div>
        )}
        {filtered.map(ins => {
          const meta = PRIORITY_COLORS[ins.priority]
          const IconComp = meta.icon
          const isExpanded = expanded.has(ins.id)
          const insComments = comments[ins.id] || []

          return (
            <div key={ins.id} className={`card ${styles.insightCard} ${ins.status==='Resolved' ? styles.resolved : ''}`}>
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
                  <span className="badge badge-default">{ins.severity} Severity</span>
                  <span className="badge badge-primary">{ins.category}</span>
                  <span className={`badge ${STATUS_COLORS[ins.status]}`}>{ins.status}</span>
                  <button className="btn btn-ghost btn-sm" style={{ padding:'2px 6px' }}>
                    {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                  </button>
                </div>
              </div>

              <p className={styles.insightMsg}>{ins.message}</p>

              {isExpanded && (
                <div className={styles.expandSection}>
                  <div className={styles.impactBox}>
                    <AlertTriangle size={13} style={{ color:'var(--color-danger)', flexShrink:0 }}/>
                    <div><strong>Impact: </strong>{ins.impact}</div>
                  </div>

                  <div className={styles.recommendation}>
                    <Lightbulb size={14} style={{ color:'var(--color-warning)', flexShrink:0, marginTop:1 }}/>
                    <span><strong>Suggested Action: </strong>{ins.recommendation}</span>
                  </div>

                  <div className={styles.metaRow}>
                    <div className={styles.metaItem}>
                      <User size={12}/> Assigned To: <strong>{ins.assignedTo}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <Clock size={12}/> Created: <strong>{ins.createdAt}</strong>
                    </div>
                  </div>

                  <div className={styles.commentsSection}>
                    <div className={styles.commentsTitle}>
                      <MessageSquare size={13}/> Comments {insComments.length > 0 && `(${insComments.length})`}
                    </div>
                    {insComments.map((c, ci) => (
                      <div key={ci} className={styles.commentItem}>
                        <div className={styles.commentAvatar}>Y</div>
                        <div className={styles.commentBody}>
                          <div className={styles.commentText}>{c.text}</div>
                          <div className={styles.commentTime}>{c.user} Â· {c.time}</div>
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
    </div>
  )
}
