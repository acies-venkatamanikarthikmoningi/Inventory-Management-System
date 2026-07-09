import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { Search, Filter, Download, ChevronUp, ChevronDown, X, Package, Layers, MapPin, Activity, Tag, Settings } from 'lucide-react'
import inventoryData from '../../data/inventory.json'
import Drawer, { DrawerSection, DetailGrid, MovementHistory } from '../../components/Drawer/Drawer'
import styles from './InventorySnapshot.module.css'

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

const parseShelf = (locBin) => {
  const parts = (locBin || '').trim().split(' ')
  if (parts.length >= 2) {
    const shelfPart = parts[1].split('-')[0]
    return `Shelf ${shelfPart}`
  }
  return 'Shelf A1'
}

const getBucket = (item) => {
  if (item.classification === 'Damaged') return 'Damaged'
  if (item.availableQty >= 2500) return 'Excess'
  return 'Good'
}

const ALL_COLUMNS = [
  { id: 'skuCode',        label: 'SKU Name' },
  { id: 'skuName',        label: 'SKU Description' },
  { id: 'bin',            label: 'Bin' },
  { id: 'zone',           label: 'Zone' },
  { id: 'area',           label: 'Area' },
  { id: 'batch',          label: 'Batch' },
  { id: 'mfgDate',        label: 'Manufacturing Date' },
  { id: 'expiry',         label: 'Expiry Date' },
  { id: 'shelfLife',      label: 'Shelf Life' },
  { id: 'classification', label: 'Classification' },
  { id: 'bucket',         label: 'Bucket' },
  { id: 'availableQty',   label: 'Available Inventory Position (Available IP)' },
]

/* ── Helpers ─────────────────────────────────────────── */
const today    = new Date()
const daysUntil = d => Math.ceil((new Date(d) - today) / 86400000)

const statusClass = s => ({
  Healthy:  'badge-success',
  Low:      'badge-warning',
  Critical: 'badge-danger',
}[s] || 'badge-default')

const classificationClass = c => ({
  'Fast Moving':   'badge-success',
  'Medium Moving': 'badge-warning',
  'Slow Moving':   'badge-info',
}[c] || 'badge-default')

const CATEGORIES  = [...new Set(inventoryData.map(i => i.category))]
const BRANDS      = [...new Set(inventoryData.map(i => i.brand))]
const NODES       = [...new Set(inventoryData.map(i => i.node))]
const PAGE_SIZES  = [10, 25, 50]

const EMPTY_FILTERS = {
  category:'', brand:'', node:'', status:'',
  lowStock: false, nearExpiry: false, damaged: false,
  expiryFrom: '', expiryTo: '',
}

export default function InventorySnapshot() {
  const { showToast, node } = useApp()
  const [search, setSearch]           = useState('')
  const [filters, setFilters]         = useState(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [showColumnSelector, setShowColumnSelector] = useState(false)
  const [visibleCols, setVisibleCols] = useState({
    skuCode: true,
    skuName: true,
    bin: true,
    zone: true,
    area: true,
    batch: true,
    mfgDate: true,
    expiry: true,
    shelfLife: true,
    classification: true,
    bucket: true,
    availableQty: true,
  })
  const [sort, setSort]               = useState({ col: 'skuCode', dir: 'asc' })
  const [page, setPage]               = useState(1)
  const [pageSize, setPageSize]       = useState(10)
  const [drawerItem, setDrawerItem]   = useState(null)
  const [drawerOpen, setDrawerOpen]   = useState(false)

  const toggleCol = (colId) => {
    setVisibleCols(prev => ({ ...prev, [colId]: !prev[colId] }))
  }

  /* ── Open Drawer ──────────────────────────────────── */
  const openDrawer = item => { setDrawerItem(item); setDrawerOpen(true) }
  const closeDrawer = () => setDrawerOpen(false)

  /* ── Filtering ─────────────────────────────────────── */
  const filtered = useMemo(() => {
    const dbNodeMap = {
      'Mumbai Distribution Center': 'Mumbai Distribution Center',
      'Pune Distribution Center': 'Pune Warehouse',
      'Hyderabad Distribution Center': 'Hyderabad Plant',
      'Bangalore Distribution Center': 'Bangalore Distribution Center',
      'Chennai Distribution Center': 'Chennai Distribution Center',
    }
    const targetNode = dbNodeMap[node] || node

    let data = inventoryData
    if (targetNode) {
      data = data.filter(i => i.node === targetNode)
    }

    const q = search.toLowerCase()
    if (q) data = data.filter(i =>
      i.skuCode.toLowerCase().includes(q) ||
      i.skuName.toLowerCase().includes(q) ||
      i.batch.toLowerCase().includes(q) ||
      i.location.toLowerCase().includes(q) ||
      i.brand.toLowerCase().includes(q) ||
      i.classification.toLowerCase().includes(q)
    )
    if (filters.category) data = data.filter(i => i.category === filters.category)
    if (filters.brand)    data = data.filter(i => i.brand    === filters.brand)
    if (filters.status)   data = data.filter(i => i.status   === filters.status)
    if (filters.lowStock)   data = data.filter(i => i.status === 'Low' || i.status === 'Critical')
    if (filters.nearExpiry) data = data.filter(i => { const d = daysUntil(i.expiry); return d > 0 && d <= 90 })
    if (filters.damaged)    data = data.filter(i => i.classification === 'Damaged')
    if (filters.expiryFrom) data = data.filter(i => new Date(i.expiry) >= new Date(filters.expiryFrom))
    if (filters.expiryTo)   data = data.filter(i => new Date(i.expiry) <= new Date(filters.expiryTo))
    return data
  }, [search, filters, node])

  /* ── Sorting ─────────────────────────────────────────── */
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let va = a[sort.col], vb = b[sort.col]
      if (sort.col === 'bin' || sort.col === 'zone' || sort.col === 'area') {
        va = parseLocation(a.location)[sort.col]
        vb = parseLocation(b.location)[sort.col]
      } else if (sort.col === 'bucket') {
        va = getBucket(a)
        vb = getBucket(b)
      }
      
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      if (va < vb) return sort.dir === 'asc' ? -1 : 1
      if (va > vb) return sort.dir === 'asc' ?  1 : -1
      return 0
    })
    return arr
  }, [filtered, sort])

  const totalPages = Math.ceil(sorted.length / pageSize)
  const paged      = sorted.slice((page - 1) * pageSize, page * pageSize)

  const handleSort = col => {
    setSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sort.col !== col) return <span style={{ opacity:0.3 }}>↕</span>
    return sort.dir === 'asc' ? <ChevronUp size={12}/> : <ChevronDown size={12}/>
  }

  /* ── CSV Export (filtered) ──────────────────────────── */
  const handleExportCSV = () => {
    const headers = ['SKU Code','SKU Name','Location','Node','Classification','Batch','Available Qty','Reserved Qty','Status','Expiry']
    const rows    = sorted.map(i => [i.skuCode,i.skuName,i.location,i.node,i.classification,i.batch,i.availableQty,i.reservedQty,i.status,i.expiry])
    const csv     = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob    = new Blob([csv], { type:'text/csv' })
    const url     = URL.createObjectURL(blob)
    const a       = document.createElement('a')
    a.href = url; a.download = 'inventory_filtered.csv'; a.click()
    showToast(`Exported ${sorted.length} filtered records as CSV`, 'success')
  }

  /* ── Active filter chips ─────────────────────────────── */
  const activeChips = [
    ...(search ? [{ key:'search', label:`Search: "${search}"`, clear: () => setSearch('') }] : []),
    ...(filters.category ? [{ key:'cat', label:`Category: ${filters.category}`, clear: () => setFilters(p=>({...p,category:''})) }] : []),
    ...(filters.brand    ? [{ key:'br',  label:`Brand: ${filters.brand}`,        clear: () => setFilters(p=>({...p,brand:''})) }] : []),
    ...(filters.status   ? [{ key:'st',  label:`Status: ${filters.status}`,      clear: () => setFilters(p=>({...p,status:''})) }] : []),
    ...(filters.lowStock   ? [{ key:'ls', label:'Low Stock Only',   clear: () => setFilters(p=>({...p,lowStock:false})) }] : []),
    ...(filters.nearExpiry ? [{ key:'ne', label:'Near Expiry Only', clear: () => setFilters(p=>({...p,nearExpiry:false})) }] : []),
    ...(filters.expiryFrom ? [{ key:'ef', label:`Expiry from ${filters.expiryFrom}`, clear: () => setFilters(p=>({...p,expiryFrom:''})) }] : []),
    ...(filters.expiryTo   ? [{ key:'et', label:`Expiry to ${filters.expiryTo}`,     clear: () => setFilters(p=>({...p,expiryTo:''})) }] : []),
  ]

  const clearAll = () => { setFilters(EMPTY_FILTERS); setSearch(''); setPage(1) }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h2>Inventory Snapshot</h2>
          <p>Live visibility for <strong>{node || 'Selected Node'}</strong> — <strong>{filtered.length}</strong> records shown</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>
            <Download size={14} /> Export Filtered ({sorted.length})
          </button>
        </div>
      </div>

      {/* Search + Filter Bar */}
      <div className={`card ${styles.toolBar}`}>
        <div className={styles.searchWrap}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search SKU, batch, location, brand, classification..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
          {search && (
            <button className={styles.clearBtn} onClick={() => setSearch('')}><X size={14}/></button>
          )}
        </div>
        <button
          className={`btn btn-secondary btn-sm ${showFilters ? styles.filterActive : ''}`}
          onClick={() => {
            setShowFilters(f => !f)
            setShowColumnSelector(false)
          }}
        >
          <Filter size={14} />
          Filters
          {activeChips.length > 0 && <span className={styles.filterBadge}>{activeChips.length}</span>}
        </button>
        <button
          className={`btn btn-secondary btn-sm ${showColumnSelector ? styles.filterActive : ''}`}
          onClick={() => {
            setShowColumnSelector(s => !s)
            setShowFilters(false)
          }}
        >
          <Settings size={14} />
          Columns
        </button>
        {activeChips.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={clearAll}>
            <X size={14} /> Clear All
          </button>
        )}
        <div style={{ flex:1 }} />
        <div className={styles.pageSizeWrap}>
          Show:
          <select className="form-select" style={{ width:70 }} value={pageSize}
            onChange={e => { setPageSize(+e.target.value); setPage(1) }}>
            {PAGE_SIZES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className={styles.chipRow}>
          {activeChips.map(chip => (
            <button key={chip.key} className={styles.chip} onClick={chip.clear}>
              {chip.label} <X size={11} />
            </button>
          ))}
        </div>
      )}

      {/* Advanced Filter Panel */}
      {showFilters && (
        <div className={`card ${styles.filterPanel}`}>
          <div className={styles.filterGrid}>
            {[
              { key:'category', label:'Category', type:'select', opts:CATEGORIES },
              { key:'brand',    label:'Brand',    type:'select', opts:BRANDS    },
              { key:'status',   label:'Status',   type:'select', opts:['Healthy','Low','Critical'] },
            ].map(f => (
              <div key={f.key} className="form-group">
                <label className="form-label">{f.label}</label>
                <select
                  className="form-select"
                  value={filters[f.key]}
                  onChange={e => { setFilters(p=>({...p,[f.key]:e.target.value})); setPage(1) }}
                >
                  <option value="">All {f.label}s</option>
                  {f.opts.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
            <div className="form-group">
              <label className="form-label">Expiry From</label>
              <input type="date" className="form-input" value={filters.expiryFrom}
                onChange={e=>{ setFilters(p=>({...p,expiryFrom:e.target.value})); setPage(1) }}/>
            </div>
            <div className="form-group">
              <label className="form-label">Expiry To</label>
              <input type="date" className="form-input" value={filters.expiryTo}
                onChange={e=>{ setFilters(p=>({...p,expiryTo:e.target.value})); setPage(1) }}/>
            </div>
          </div>
          <div className={styles.toggleRow}>
            {[
              { key:'lowStock',   label:'Low Stock Only'   },
              { key:'nearExpiry', label:'Near Expiry (<90 days)' },
            ].map(t => (
              <button
                key={t.key}
                className={`${styles.toggleChip} ${filters[t.key] ? styles.toggleChipOn : ''}`}
                onClick={() => { setFilters(p=>({...p,[t.key]:!p[t.key]})); setPage(1) }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Column Selector Panel */}
      {showColumnSelector && (
        <div className={`card ${styles.filterPanel}`} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Select Visible Columns</span>
            <button className="btn btn-ghost btn-xs" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => {
              setVisibleCols({
                skuCode: true, skuName: true, bin: true, zone: true, area: true, batch: true,
                mfgDate: true, expiry: true, shelfLife: true, classification: true, bucket: true, availableQty: true
              })
            }}>
              Reset Columns
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {ALL_COLUMNS.map(col => (
              <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={visibleCols[col.id]}
                  onChange={() => toggleCol(col.id)}
                  style={{ cursor: 'pointer' }}
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        <div className="table-container" style={{ borderRadius:12, overflowY: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                {ALL_COLUMNS.map(h => visibleCols[h.id] && (
                  <th key={h.id} onClick={() => handleSort(h.id)}>
                    <span className={styles.thInner}>{h.label} <SortIcon col={h.id}/></span>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={Object.values(visibleCols).filter(Boolean).length + 1}>
                    <div className="empty-state">
                      <Search size={32} />
                      <h4>No records found</h4>
                      <p>Try adjusting your search or filters.</p>
                    </div>
                  </td>
                </tr>
              ) : paged.map(item => {
                const days = daysUntil(item.expiry)
                const locParts = parseLocation(item.location)
                const bucketVal = getBucket(item)
                
                return (
                  <tr key={item.id} className={styles.tableRow} onClick={() => openDrawer(item)}>
                    {visibleCols.skuCode && (
                      <td onClick={e=>e.stopPropagation()}>
                        <code className={styles.skuCode}>{item.skuCode}</code>
                      </td>
                    )}
                    {visibleCols.skuName && (
                      <td>
                        <div className={styles.skuName}>{item.skuName}</div>
                        <div className="text-xs text-muted">{item.brand}</div>
                      </td>
                    )}
                    {visibleCols.bin && (
                      <td className="text-sm">
                        <Link
                          to={`/app/locations?zone=${encodeURIComponent(locParts.zone)}&area=${encodeURIComponent(locParts.area)}&shelf=${encodeURIComponent(parseShelf(locParts.bin))}&bin=${encodeURIComponent(locParts.bin)}&sku=${encodeURIComponent(item.skuCode)}`}
                          style={{ color: 'var(--color-primary-light)', fontWeight: 500, textDecoration: 'underline' }}
                        >
                          {locParts.bin}
                        </Link>
                      </td>
                    )}
                    {visibleCols.zone && (
                      <td className="text-sm">
                        <Link
                          to={`/app/locations?zone=${encodeURIComponent(locParts.zone)}`}
                          style={{ color: 'var(--color-primary-light)', fontWeight: 500, textDecoration: 'underline' }}
                        >
                          {locParts.zone}
                        </Link>
                      </td>
                    )}
                    {visibleCols.area && (
                      <td className="text-sm">
                        <Link
                          to={`/app/locations?zone=${encodeURIComponent(locParts.zone)}&area=${encodeURIComponent(locParts.area)}`}
                          style={{ color: 'var(--color-primary-light)', fontWeight: 500, textDecoration: 'underline' }}
                        >
                          {locParts.area}
                        </Link>
                      </td>
                    )}
                    {visibleCols.batch && (
                      <td className="text-sm text-muted">{item.batch}</td>
                    )}
                    {visibleCols.mfgDate && (
                      <td className="text-sm">{item.mfgDate}</td>
                    )}
                    {visibleCols.expiry && (
                      <td>
                        <div className={styles.expiryCell}>
                          <span className="text-sm">{item.expiry}</span>
                          {days <= 90 && days > 0 && (
                            <span className={`badge ${days<=30?'badge-danger':'badge-warning'}`} style={{fontSize:10}}>{days}d</span>
                          )}
                          {days <= 0 && <span className="badge badge-danger" style={{fontSize:10}}>Expired</span>}
                        </div>
                      </td>
                    )}
                    {visibleCols.shelfLife && (
                      <td className="text-sm">{item.shelfLife} Months</td>
                    )}
                    {visibleCols.classification && (
                      <td><span className={`badge ${classificationClass(item.classification)}`}>{item.classification}</span></td>
                    )}
                    {visibleCols.bucket && (
                      <td>
                        <span className={`badge ${
                          bucketVal === 'Good' ? 'badge-success' : bucketVal === 'Damaged' ? 'badge-danger' : 'badge-warning'
                        }`}>{bucketVal}</span>
                      </td>
                    )}
                    {visibleCols.availableQty && (
                      <td><strong>{item.availableQty.toLocaleString()}</strong></td>
                    )}
                    <td onClick={e=>e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openDrawer(item)}>
                        View Details →
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className={styles.paginationBar}>
          <span className="text-sm text-muted">
            Showing {Math.min((page-1)*pageSize+1, sorted.length)}–{Math.min(page*pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="pagination">
            <button className="pagination-btn" onClick={()=>setPage(1)} disabled={page===1}>«</button>
            <button className="pagination-btn" onClick={()=>setPage(p=>p-1)} disabled={page===1}>‹</button>
            {Array.from({length:Math.min(5,totalPages)},(_,i)=>{
              const p = Math.max(1,Math.min(page-2,totalPages-4))+i
              return <button key={p} className={`pagination-btn ${p===page?'active':''}`} onClick={()=>setPage(p)}>{p}</button>
            })}
            <button className="pagination-btn" onClick={()=>setPage(p=>p+1)} disabled={page===totalPages||totalPages===0}>›</button>
            <button className="pagination-btn" onClick={()=>setPage(totalPages)} disabled={page===totalPages||totalPages===0}>»</button>
          </div>
        </div>
      </div>

      {/* ── Side Drawer ──────────────────────────────── */}
      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={drawerItem?.skuName || ''}
        subtitle={`${drawerItem?.skuCode || ''} · ${drawerItem?.batch || ''}`}
      >
        {drawerItem && (
          <>
            {/* General Info */}
            <DrawerSection title="General Information" icon={Package}>
              <DetailGrid items={[
                ['SKU Code',       drawerItem.skuCode],
                ['SKU Name',       drawerItem.skuName],
                ['Brand',          drawerItem.brand],
                ['Category',       drawerItem.category],
                ['Classification', drawerItem.classification],
                ['Unit of Measure',drawerItem.uom],
              ]}/>
            </DrawerSection>

            {/* Storage Info */}
            <DrawerSection title="Storage Information" icon={MapPin}>
              <DetailGrid items={[
                ['Node',              drawerItem.node],
                ['Location',          drawerItem.location],
                ['Storage Condition', drawerItem.storageCondition],
                ['Shelf Life',        `${drawerItem.shelfLife} Months`],
              ]}/>
            </DrawerSection>

            {/* Inventory Quantities */}
            <DrawerSection title="Inventory Quantities" icon={Layers}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  { label:'On Hand Quantity', val: drawerItem.onHandQty ?? Math.round(drawerItem.availableQty * 0.85), color:'var(--color-success)' },
                  { label:'Open Sales Orders',  val: drawerItem.reservedQty,  color:'var(--color-warning)' },
                  { label:'In Transit Quantity', val: drawerItem.inTransitQty ?? (drawerItem.availableQty - Math.round(drawerItem.availableQty * 0.85)), color:'var(--color-info)' },
                  { label:'Available Inventory Position (Available IP)', val: drawerItem.availableQty, color:'var(--color-primary-light)' },
                ].map(q => (
                  <div key={q.label} style={{ textAlign:'center', padding:'12px 8px', background:'var(--color-surface-hover)', borderRadius:8 }}>
                    <div style={{ fontSize:22, fontWeight:800, color:q.color }}>{q.val.toLocaleString()}</div>
                    <div style={{ fontSize:10, color:'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:2 }}>{q.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--color-text-muted)', marginBottom:4 }}>
                  <span>Open Sales Orders Ratio</span>
                  <span>{Math.round((drawerItem.reservedQty/(drawerItem.availableQty+drawerItem.reservedQty))*100)}%</span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width:`${Math.round((drawerItem.reservedQty/(drawerItem.availableQty+drawerItem.reservedQty))*100)}%`, background:'var(--color-warning)' }}/>
                </div>
              </div>
            </DrawerSection>

            {/* Batch Info */}
            <DrawerSection title="Batch Information" icon={Tag}>
              <DetailGrid items={[
                ['Batch Number',       drawerItem.batch],
                ['Manufacturing Date', drawerItem.mfgDate],
                ['Expiry Date',        drawerItem.expiry],
                ['Remaining Days',     (() => { const d = daysUntil(drawerItem.expiry); return d <= 0 ? 'Expired' : `${d} days` })()],
                ['Inventory Type',     'FEFO'],
                ['Bucket',             getBucket(drawerItem)],
              ]}/>
              {(() => {
                const d = daysUntil(drawerItem.expiry)
                if (d <= 0) return <div className="badge badge-danger" style={{ display:'inline-flex' }}>⚠️ This batch is expired</div>
                if (d <= 30) return <div className="badge badge-danger" style={{ display:'inline-flex' }}>⚠️ Expiring in {d} days</div>
                if (d <= 90) return <div className="badge badge-warning" style={{ display:'inline-flex' }}>Near expiry — {d} days remaining</div>
                return null
              })()}
            </DrawerSection>

            {/* Bucket */}
            <DrawerSection title="Inventory Bucket" icon={Activity}>
              <DetailGrid items={[
                ['Current Bucket',    getBucket(drawerItem)],
                ['Last Updated',      '2026-06-30 09:45 AM'],
                ['Updated By',        'Ravi Kumar'],
                ['Location Verified', 'Yes'],
              ]}/>
            </DrawerSection>

            {/* Movement History */}
            <DrawerSection title="Movement History" icon={Activity}>
              <MovementHistory skuCode={drawerItem.skuCode} />
            </DrawerSection>
          </>
        )}
      </Drawer>
    </div>
  )
}
