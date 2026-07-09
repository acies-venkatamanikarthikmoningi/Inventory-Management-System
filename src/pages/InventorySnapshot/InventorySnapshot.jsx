import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { Search, Filter, Download, ChevronUp, ChevronDown, X, Package, Layers, MapPin, Activity, Tag, Settings } from 'lucide-react'
import areaMaster from '../../data/areaMaster.json'
import binCapacityMaster from '../../data/binCapacityMaster.json'
import skuMasterData from '../../data/sku.json'
import Drawer, { DrawerSection, DetailGrid, MovementHistory } from '../../components/Drawer/Drawer'
import styles from './InventorySnapshot.module.css'

/* ── Enterprise Helpers ─────────────────────────────── */
const parseLocation = (locOrItem) => {
  if (locOrItem && typeof locOrItem === 'object') {
    return {
      bin: locOrItem.binCode || locOrItem.location || '',
      zone: locOrItem.zoneCode || 'Zone 1',
      area: locOrItem.areaCode || 'General Storage',
    }
  }

  const loc = locOrItem
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

const CASES_PER_PALLET = 40
const CASES_TO_EACHES = 24
const EACHES_PER_PALLET = CASES_TO_EACHES * CASES_PER_PALLET

const hashString = value => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const randomFromSeed = (seed, salt = '') => hashString(`${seed}|${salt}`) / 4294967295
const randomIntFromSeed = (seed, salt, min, max) => min + Math.floor(randomFromSeed(seed, salt) * (max - min + 1))

const getUomSimulation = item => {
  const seed = [
    item.skuCode,
    item.batch,
    item.binCode || parseLocation(item).bin,
    item.id,
  ].filter(Boolean).join('|')
  const typeRoll = randomFromSeed(seed, 'uom-type')

  if (typeRoll < 0.4) {
    const quantity = randomIntFromSeed(seed, 'each-qty', 10, 300)
    return { type: 'Each', quantity, qtyInBaseUom: quantity }
  }

  if (typeRoll < 0.85) {
    const quantity = randomIntFromSeed(seed, 'case-qty', 2, 25)
    return { type: 'Case', quantity, qtyInBaseUom: quantity * CASES_TO_EACHES }
  }

  const quantity = randomIntFromSeed(seed, 'pallet-qty', 1, 2)
  return { type: 'Pallet', quantity, qtyInBaseUom: quantity * EACHES_PER_PALLET }
}

const getUomDisplay = item => {
  const { type } = getUomSimulation(item)
  if (type === 'Case') return 'CASES'
  if (type === 'Pallet') return 'PALLETS'
  return 'EACHES'
}

const getUomBadgeClass = item => {
  const { type } = getUomSimulation(item)
  if (type === 'Case') return 'badge-info'
  if (type === 'Pallet') return styles.uomPalletBadge
  return 'badge-warning'
}

const formatPlainNumber = value => Number(value || 0).toLocaleString()

const getBinTypeForBin = (binOrLocationString) => {
  const value = (binOrLocationString || '').toLowerCase()
  if (value.includes('fg1') || value.includes('rs1')) return 'RACK2D'
  if (value.includes('fg2') || value.includes('rs2')) return 'AISLE'
  if (value.includes('pk1')) return 'PICKDROP'
  if (value.includes('pk2')) return 'EACHPICK'
  if (value.includes('damage')) return 'DMGUNL'
  if (value.includes('receiv')) return 'RECVDOCK'
  if (value.includes('stage') || value.includes('staging')) return 'STAGE4P'
  if (value.includes('bulk') || value.includes('unlimited')) return 'BULKUNL'
  if (value.includes('each')) return 'EACHPICK'
  if (value.includes('pick')) return 'PICKDROP'
  if (value.includes('reserve') || value.includes('rack')) return 'RACK2D'
  return 'AISLE'
}

const formatQtyForBin = (qty, binOrLocationString, typeCodeOverride = '') => {
  const numericQty = Number(qty) || 0
  const typeCode = typeCodeOverride || getBinTypeForBin(binOrLocationString)
  const capacity = binCapacityMaster.find(record => record.typeCode === typeCode)
  const casesDisplay = numericQty.toLocaleString()

  if (capacity?.storageHuType === 'PALLET' && capacity.binPalletCapacity > 0) {
    return `${(numericQty / CASES_PER_PALLET).toFixed(1)} pallets (${casesDisplay} cases)`
  }

  return `${casesDisplay} cases`
}

const uniqueSorted = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))

const areaDescriptionByCode = Object.fromEntries(
  areaMaster.map(area => [area.areaCode, area.description])
)

const formatArea = (areaCode) => {
  const description = areaDescriptionByCode[areaCode]
  return description ? `${areaCode} — ${description}` : areaCode
}

const getAreaDescription = areaCode => areaDescriptionByCode[areaCode] || ''

const dbNodeMap = {
  'Mumbai Distribution Center': 'Mumbai Distribution Center',
  'Pune Distribution Center': 'Pune Warehouse',
  'Hyderabad Distribution Center': 'Hyderabad Plant',
  'Bangalore Distribution Center': 'Bangalore Distribution Center',
  'Chennai Distribution Center': 'Chennai Distribution Center',
}

const SKU_REORDER_POINTS = Object.fromEntries(
  skuMasterData.map(sku => [sku.skuCode, sku.reorderPoint || 0])
)

const ALL_COLUMNS = [
  { id: 'skuCode',        label: 'SKU Name' },
  { id: 'skuName',        label: 'SKU Description' },
  { id: 'areaCode',       label: 'Area Code' },
  { id: 'areaDescription', label: 'Description' },
  { id: 'zone',           label: 'Zone' },
  { id: 'bin',            label: 'Bin' },
  { id: 'batch',          label: 'Batch' },
  { id: 'mfgDate',        label: 'Manufacturing Date' },
  { id: 'expiry',         label: 'Expiry Date' },
  { id: 'shelfLife',      label: 'Shelf Life' },
  { id: 'classification', label: 'Classification' },
  { id: 'bucket',         label: 'Bucket' },
  { id: 'quantity',       label: 'Quantity' },
  { id: 'uom',            label: 'UOM' },
  { id: 'qtyBaseUom',     label: 'Qty in Base UOM' },
]

/* ── Helpers ─────────────────────────────────────────── */
const today    = new Date()
const daysUntil = d => Math.ceil((new Date(d) - today) / 86400000)

const classificationClass = c => ({
  'Fast Moving':   'badge-success',
  'Medium Moving': 'badge-warning',
  'Slow Moving':   'badge-info',
}[c] || 'badge-default')

const PAGE_SIZES  = [10, 25, 50]

const EMPTY_FILTERS = {
  sku:'', area:'', zone:'', bin:'', classification:'', bucket:'',
  lowStock: false, nearExpiry: false,
  expiryFrom: '', expiryTo: '',
}

export default function InventorySnapshot() {
  const { showToast, node, inventoryData } = useApp()
  const [search, setSearch]           = useState('')
  const [filters, setFilters]         = useState(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [showColumnSelector, setShowColumnSelector] = useState(false)
  const [visibleCols, setVisibleCols] = useState({
    skuCode: true,
    skuName: true,
    bin: true,
    zone: true,
    areaCode: true,
    areaDescription: true,
    batch: true,
    mfgDate: true,
    expiry: true,
    shelfLife: true,
    classification: true,
    bucket: true,
    quantity: true,
    uom: true,
    qtyBaseUom: true,
  })
  const [sort, setSort]               = useState({ col: 'skuCode', dir: 'asc' })
  const [page, setPage]               = useState(1)
  const [pageSize, setPageSize]       = useState(10)
  const [drawerItem, setDrawerItem]   = useState(null)
  const [drawerOpen, setDrawerOpen]   = useState(false)

  const toggleCol = (colId) => {
    setVisibleCols(prev => ({ ...prev, [colId]: !prev[colId] }))
  }

  const scopedData = useMemo(() => {
    const targetNode = dbNodeMap[node] || node
    if (!targetNode) return inventoryData
    return inventoryData.filter(i => i.node === targetNode)
  }, [inventoryData, node])

  const filterOptions = useMemo(() => {
    const areaRows = filters.area
      ? scopedData.filter(i => parseLocation(i).area === filters.area)
      : scopedData
    const binRows = filters.zone
      ? areaRows.filter(i => parseLocation(i).zone === filters.zone)
      : areaRows

    return {
      skus: uniqueSorted(scopedData.map(i => i.skuName)),
      areas: uniqueSorted(scopedData.map(i => parseLocation(i).area)),
      zones: uniqueSorted(areaRows.map(i => parseLocation(i).zone)),
      bins: uniqueSorted(binRows.map(i => parseLocation(i).bin)),
      classifications: uniqueSorted(scopedData.map(i => i.classification)),
      buckets: uniqueSorted(scopedData.map(i => getBucket(i))),
    }
  }, [scopedData, filters.area, filters.zone])

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const handleAreaChange = (area) => {
    setFilters(prev => {
      const areaRows = area
        ? scopedData.filter(i => parseLocation(i).area === area)
        : scopedData
      const zone = prev.zone && areaRows.some(i => parseLocation(i).zone === prev.zone) ? prev.zone : ''
      const zoneRows = zone
        ? areaRows.filter(i => parseLocation(i).zone === zone)
        : areaRows
      const bin = prev.bin && zoneRows.some(i => parseLocation(i).bin === prev.bin) ? prev.bin : ''
      return { ...prev, area, zone, bin }
    })
    setPage(1)
  }

  const handleZoneChange = (zone) => {
    setFilters(prev => {
      const areaRows = prev.area
        ? scopedData.filter(i => parseLocation(i).area === prev.area)
        : scopedData
      const zoneRows = zone
        ? areaRows.filter(i => parseLocation(i).zone === zone)
        : areaRows
      const bin = prev.bin && zoneRows.some(i => parseLocation(i).bin === prev.bin) ? prev.bin : ''
      return { ...prev, zone, bin }
    })
    setPage(1)
  }

  /* ── Open Drawer ──────────────────────────────────── */
  const openDrawer = item => { setDrawerItem(item); setDrawerOpen(true) }
  const closeDrawer = () => setDrawerOpen(false)

  /* ── Filtering ─────────────────────────────────────── */
  const filtered = useMemo(() => {
    let data = scopedData
    const availableBySku = scopedData.reduce((acc, item) => {
      acc[item.skuCode] = (acc[item.skuCode] || 0) + (item.availableQty || 0)
      return acc
    }, {})

    const q = search.toLowerCase()
    if (q) data = data.filter(i =>
      i.skuCode.toLowerCase().includes(q) ||
      i.skuName.toLowerCase().includes(q) ||
      i.batch.toLowerCase().includes(q) ||
      i.location.toLowerCase().includes(q) ||
      i.brand.toLowerCase().includes(q) ||
      i.classification.toLowerCase().includes(q)
    )
    if (filters.sku)      data = data.filter(i => i.skuName  === filters.sku)
    if (filters.area)     data = data.filter(i => parseLocation(i).area === filters.area)
    if (filters.zone)     data = data.filter(i => parseLocation(i).zone === filters.zone)
    if (filters.bin)      data = data.filter(i => parseLocation(i).bin === filters.bin)
    if (filters.classification) data = data.filter(i => i.classification === filters.classification)
    if (filters.bucket)   data = data.filter(i => getBucket(i) === filters.bucket)
    if (filters.lowStock)   data = data.filter(i => availableBySku[i.skuCode] <= (SKU_REORDER_POINTS[i.skuCode] || 0))
    if (filters.nearExpiry) data = data.filter(i => { const d = daysUntil(i.expiry); return d > 0 && d <= 90 })
    if (filters.expiryFrom) data = data.filter(i => new Date(`${i.expiry}T00:00:00`) >= new Date(`${filters.expiryFrom}T00:00:00`))
    if (filters.expiryTo)   data = data.filter(i => new Date(`${i.expiry}T00:00:00`) <= new Date(`${filters.expiryTo}T00:00:00`))
    return data
  }, [search, filters, scopedData])

  /* ── Sorting ─────────────────────────────────────────── */
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let va = a[sort.col], vb = b[sort.col]
      if (sort.col === 'bin' || sort.col === 'zone') {
        va = parseLocation(a)[sort.col]
        vb = parseLocation(b)[sort.col]
      } else if (sort.col === 'areaCode') {
        va = parseLocation(a).area
        vb = parseLocation(b).area
      } else if (sort.col === 'areaDescription') {
        va = getAreaDescription(parseLocation(a).area)
        vb = getAreaDescription(parseLocation(b).area)
      } else if (sort.col === 'bucket') {
        va = getBucket(a)
        vb = getBucket(b)
      } else if (sort.col === 'quantity') {
        va = getUomSimulation(a).quantity
        vb = getUomSimulation(b).quantity
      } else if (sort.col === 'uom') {
        va = getUomDisplay(a)
        vb = getUomDisplay(b)
      } else if (sort.col === 'qtyBaseUom') {
        va = getUomSimulation(a).qtyInBaseUom
        vb = getUomSimulation(b).qtyInBaseUom
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
    ...(filters.sku      ? [{ key:'sku', label:`SKU: ${filters.sku}`,            clear: () => setFilters(p=>({...p,sku:''})) }] : []),
    ...(filters.area     ? [{ key:'area', label:`Area: ${formatArea(filters.area)}`, clear: () => handleAreaChange('') }] : []),
    ...(filters.zone     ? [{ key:'zone', label:`Zone: ${filters.zone}`,         clear: () => handleZoneChange('') }] : []),
    ...(filters.bin      ? [{ key:'bin', label:`Bin: ${filters.bin}`,            clear: () => setFilters(p=>({...p,bin:''})) }] : []),
    ...(filters.classification ? [{ key:'class', label:`Classification: ${filters.classification}`, clear: () => setFilters(p=>({...p,classification:''})) }] : []),
    ...(filters.bucket   ? [{ key:'bucket', label:`Bucket: ${filters.bucket}`,   clear: () => setFilters(p=>({...p,bucket:''})) }] : []),
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
              { key:'sku',      label:'SKU',      type:'select', opts:filterOptions.skus },
              { key:'area',     label:'Area',     type:'select', opts:filterOptions.areas },
              { key:'zone',     label:'Zone',     type:'select', opts:filterOptions.zones },
              { key:'bin',      label:'Bin',      type:'select', opts:filterOptions.bins },
              { key:'classification', label:'Classification', type:'select', opts:filterOptions.classifications },
              { key:'bucket',   label:'Bucket',   type:'select', opts:filterOptions.buckets },
            ].map(f => (
              <div key={f.key} className="form-group">
                <label className="form-label">{f.label}</label>
                <select
                  className="form-select"
                  value={filters[f.key]}
                  onChange={e => {
                    if (f.key === 'area') handleAreaChange(e.target.value)
                    else if (f.key === 'zone') handleZoneChange(e.target.value)
                    else updateFilter(f.key, e.target.value)
                  }}
                >
                  <option value="">All {f.label}s</option>
                  {f.opts.map(o => (
                    <option key={o} value={o}>
                      {f.key === 'area' ? formatArea(o) : o}
                    </option>
                  ))}
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
                skuCode: true, skuName: true, bin: true, zone: true, areaCode: true, areaDescription: true, batch: true,
                mfgDate: true, expiry: true, shelfLife: true, classification: true, bucket: true,
                quantity: true, uom: true, qtyBaseUom: true
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
                const locParts = parseLocation(item)
                const bucketVal = getBucket(item)
                const uomSim = getUomSimulation(item)
                
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
                    {visibleCols.areaCode && (
                      <td className="text-sm">{locParts.area}</td>
                    )}
                    {visibleCols.areaDescription && (
                      <td className="text-sm">{getAreaDescription(locParts.area)}</td>
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
                    {visibleCols.quantity && (
                      <td className="text-sm" style={{ textAlign: 'right' }}>
                        {formatPlainNumber(uomSim.quantity)}
                      </td>
                    )}
                    {visibleCols.uom && (
                      <td>
                        <span className={`badge ${getUomBadgeClass(item)}`}>{getUomDisplay(item)}</span>
                      </td>
                    )}
                    {visibleCols.qtyBaseUom && (
                      <td className="text-sm" style={{ textAlign: 'right' }}>
                        {formatPlainNumber(uomSim.qtyInBaseUom)}
                      </td>
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
                    <div style={{ fontSize:14, fontWeight:800, color:q.color, lineHeight:1.25 }}>{formatQtyForBin(q.val, drawerItem.location, drawerItem.binTypeCode)}</div>
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
