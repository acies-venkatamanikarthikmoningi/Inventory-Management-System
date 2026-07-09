import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { Search, Edit2, Save, X, Eye, Plus } from 'lucide-react'
import skuData from '../../data/sku.json'
import styles from './SKUMaster.module.css'

export default function SKUMaster() {
  const { showToast, node, inventoryData } = useApp()
  const [searchQuery, setSearchQuery] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [results, setResults] = useState([])
  const [editId, setEditId]     = useState(null)
  const [editForm, setEditForm] = useState({})
  const [viewSku, setViewSku]   = useState(null)
  const [page, setPage]         = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // Reconcile selected node names with mock databases
  const dbNodeMap = {
    'Mumbai Distribution Center': 'Mumbai Distribution Center',
    'Pune Distribution Center': 'Pune Warehouse',
    'Hyderabad Distribution Center': 'Hyderabad Plant',
    'Bangalore Distribution Center': 'Bangalore Distribution Center',
    'Chennai Distribution Center': 'Chennai Distribution Center',
  }
  const targetNode = dbNodeMap[node] || node

  // Find all unique SKU codes active at this Distribution Center node
  const activeSkuCodes = useMemo(() => {
    const codes = inventoryData
      .filter(i => i.node === targetNode)
      .map(i => i.skuCode)
    return new Set(codes)
  }, [inventoryData, targetNode])

  // Filter global catalog to only display SKUs active at this DC
  const dcSkus = useMemo(() => {
    return skuData.filter(s => activeSkuCodes.has(s.skuCode))
  }, [activeSkuCodes])

  const handleSearch = (e) => {
    if (e) e.preventDefault()
    const q = searchQuery.trim().toLowerCase()
    
    if (q === '') {
      setResults(dcSkus)
    } else {
      const filtered = dcSkus.filter(s =>
        s.skuCode.toLowerCase().includes(q) ||
        s.skuName.toLowerCase().includes(q) ||
        s.brand.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      )
      setResults(filtered)
    }
    setHasSearched(true)
    setPage(1)
  }

  const startEdit = sku => { setEditId(sku.id); setEditForm({ ...sku }) }
  const cancelEdit = () => { setEditId(null); setEditForm({}) }

  const saveEdit = () => {
    setResults(prev => prev.map(s => s.id === editId ? { ...editForm } : s))
    setEditId(null)
    showToast(`SKU ${editForm.skuCode} updated successfully`, 'success')
  }

  const totalPages = Math.ceil(results.length / pageSize)
  const pagedResults = results.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>SKU Explore</h2>
          <p>Search and explore SKU master definitions for <strong>{node || 'Selected Node'}</strong></p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary btn-sm" onClick={() => showToast('Add SKU feature — connect to backend in production', 'info')}>
            <Plus size={14} /> Add SKU
          </button>
        </div>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className={`card ${styles.searchBar}`}>
        <Search size={16} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          placeholder="Search by SKU ID, SKU Name, Category, or Brand..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm">Search</button>
        {hasSearched && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setSearchQuery('')
              setHasSearched(false)
              setResults([])
            }}
          >
            Clear
          </button>
        )}
      </form>

      {/* Initial state (no search performed yet) */}
      {!hasSearched && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--color-primary-light-bg)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', color: 'var(--color-primary-light)' }}>
            <Search size={32} />
          </div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--color-text)' }}>SKU Catalog Search</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 360, lineHeight: 1.6 }}>
            Enter a SKU ID, SKU Name, Category, or Brand in the search bar above to fetch master definitions for <strong>{node || 'Selected Node'}</strong>.
          </p>
        </div>
      )}

      {/* Search completed but no records found */}
      {hasSearched && results.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--color-danger-light)', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', color: 'var(--color-danger)' }}>
            <X size={32} />
          </div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>No SKUs Found</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 360, lineHeight: 1.6 }}>
            We couldn't find any SKU definitions matching your query in the current Distribution Center. Try adjusting your keywords.
          </p>
        </div>
      )}

      {/* SKU Cards Grid */}
      {hasSearched && results.length > 0 && (
        <div className={styles.skuGrid}>
          {pagedResults.map(sku => {
            const isEditing = editId === sku.id
            const data      = isEditing ? editForm : sku

            return (
              <div key={sku.id} className={`card ${styles.skuCard}`}>
                <div className={styles.skuCardHeader}>
                  <div>
                    <code className={styles.skuCode}>{sku.skuCode}</code>
                    <div className={styles.skuStatus}>
                      <span className={`badge ${sku.status === 'Active' ? 'badge-success' : 'badge-warning'}`}>
                        {sku.status}
                      </span>
                    </div>
                  </div>
                  <div className={styles.skuActions}>
                    {!isEditing ? (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => setViewSku(sku)}>
                          <Eye size={14} />
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(sku)}>
                          <Edit2 size={14} /> Edit
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-success btn-sm" onClick={saveEdit}>
                          <Save size={14} /> Save
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>
                          <X size={14} /> Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* SKU Name */}
                {isEditing ? (
                  <input
                    className="form-input"
                    value={editForm.skuName}
                    onChange={e => setEditForm(f => ({ ...f, skuName: e.target.value }))}
                    style={{ fontWeight: 600, marginBottom: 8 }}
                  />
                ) : (
                  <h4 className={styles.skuName}>{sku.skuName}</h4>
                )}

                {/* Fields */}
                <div className={styles.fieldGrid}>
                  {[
                    { label:'Category',   key:'category' },
                    { label:'Brand',      key:'brand' },
                    { label:'UOM',        key:'uom' },
                    { label:'Classification', key:'classification' },
                    { label:'Shelf Life (months)', key:'shelfLife' },
                    { label:'Storage',    key:'storageCondition' },
                    { label:'Inventory Type', key:'inventoryType' },
                    { label:'GST Rate',   key:'gstRate' },
                  ].map(({ label, key }) => (
                    <div key={key} className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>{label}</span>
                      {isEditing ? (
                        <input
                          className="form-input"
                          value={editForm[key] ?? ''}
                          onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                          style={{ padding:'4px 8px', fontSize: 12 }}
                        />
                      ) : (
                        <span className={styles.fieldVal}>{sku[key]}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Stock Levels */}
                <div className={styles.stockLevels}>
                  {[
                    { label:'Min Stock', val: sku.minStockLevel },
                    { label:'Reorder',   val: sku.reorderPoint },
                    { label:'Max Stock', val: sku.maxStockLevel },
                  ].map(s => (
                    <div key={s.label} className={styles.stockItem}>
                      <span className={styles.fieldLabel}>{s.label}</span>
                      <span className={styles.fieldVal}>{s.val?.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination Bar */}
      {hasSearched && results.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, padding: '12px 16px', background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Showing {Math.min((page - 1) * pageSize + 1, results.length)}–{Math.min(page * pageSize, results.length)} of {results.length} SKUs
          </span>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Show:</span>
            <select
              className="form-select"
              style={{ width: 70, padding: '4px' }}
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <div className="pagination" style={{ margin: 0 }}>
              <button className="pagination-btn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
              <button className="pagination-btn" onClick={() => setPage(p => p - 1)} disabled={page === 1}>‹</button>
              <span style={{ fontSize: 13, color: 'var(--color-text)', minWidth: 60, textAlign: 'center' }}>
                Page {page} of {totalPages || 1}
              </span>
              <button className="pagination-btn" onClick={() => setPage(p => p + 1)} disabled={page === totalPages || totalPages === 0}>›</button>
              <button className="pagination-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages || totalPages === 0}>»</button>
            </div>
          </div>
        </div>
      )}

      {/* View Detail Modal */}
      {viewSku && (
        <div className="modal-overlay" onClick={() => setViewSku(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth:620 }}>
            <div className="modal-header">
              <div>
                <h3>{viewSku.skuName}</h3>
                <p className="text-sm text-muted">{viewSku.skuCode}</p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewSku(null)}><X size={18}/></button>
            </div>
            <p className="text-sm text-muted" style={{ marginBottom:16 }}>{viewSku.description}</p>
            <div className="grid-2" style={{ gap:10 }}>
              {Object.entries({
                'Category': viewSku.category,
                'Brand': viewSku.brand,
                'UOM': viewSku.uom,
                'Classification': viewSku.classification,
                'Shelf Life': `${viewSku.shelfLife} months`,
                'Storage Condition': viewSku.storageCondition,
                'Inventory Type': viewSku.inventoryType,
                'GST Rate': `${viewSku.gstRate}%`,
                'HS Code': viewSku.hsCode,
                'Dimensions': viewSku.dimensions,
                'Weight': viewSku.weight,
                'Min Stock': viewSku.minStockLevel,
                'Reorder Point': viewSku.reorderPoint,
                'Max Stock': viewSku.maxStockLevel,
              }).map(([k,v]) => (
                <div key={k} style={{ padding:'8px 10px', background:'var(--color-surface-hover)', borderRadius:8 }}>
                  <div className="text-xs text-muted">{k}</div>
                  <div className="text-sm font-medium">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
