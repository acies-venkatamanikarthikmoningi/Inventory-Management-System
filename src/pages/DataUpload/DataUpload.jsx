import { useState, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { Upload, FileText, CheckCircle, AlertTriangle, X, Download, GitCompare, History, Edit3, RotateCcw } from 'lucide-react'
import styles from './DataUpload.module.css'

/* ── Dummy upload history ─────────────────────────────── */
const BASE_HISTORY = [
  { id:1, version:'V1', filename:'inventory_jun26.csv',   records:138, success:135, errors:3,  uploadedAt:'2026-06-26 09:00', status:'Completed' },
  { id:2, version:'V2', filename:'inventory_jun28.csv',   records:141, success:139, errors:2,  uploadedAt:'2026-06-28 11:00', status:'Completed' },
  { id:3, version:'V3', filename:'inventory_jun30.csv',   records:142, success:138, errors:4,  uploadedAt:'2026-06-30 09:00', status:'Completed' },
]

/* ── Comparison dummy data (V2 vs V3) ─────────────────── */
const COMPARISON_DATA = [
  { skuCode:'SKU-1001', skuName:'Paracetamol 500mg',    prevQty:500, curQty:420,  locChange:false, classChange:false },
  { skuCode:'SKU-1002', skuName:'Surgical Gloves (L)',   prevQty:200, curQty:150,  locChange:false, classChange:false },
  { skuCode:'SKU-1003', skuName:'Antiseptic Solution',   prevQty:300, curQty:290,  locChange:true,  classChange:false },
  { skuCode:'SKU-1007', skuName:'Disposable Syringes 5ml',prevQty:150,curQty:20,  locChange:false, classChange:false },
  { skuCode:'SKU-1016', skuName:'Ibuprofen 400mg',       prevQty:null,curQty:1200,locChange:false, classChange:false }, // New
  { skuCode:'SKU-1009', skuName:'Blood Pressure Monitor', prevQty:80, curQty:null, locChange:false, classChange:false }, // Removed
]
const COMPARE_SUMMARY = { newSKUs:1, removedSKUs:1, qtyIncreased:0, qtyDecreased:3 }

/* ── Editable validation rows ────────────────────────── */
const INITIAL_VALIDATION_ROWS = [
  { id:1, row:1, skuCode:'SKU-1016', skuName:'Ibuprofen 400mg',    location:'Rack A3 - Zone 1', qty:1200, expiry:'2027-06-30', status:'valid',   error:null },
  { id:2, row:2, skuCode:'SKU-1017', skuName:'Gloves (S)',          location:'Rack B4 - Zone 2', qty:800,  expiry:'2026-12-31', status:'valid',   error:null },
  { id:3, row:3, skuCode:'',         skuName:'Unknown Item',         location:'',                 qty:'',   expiry:'',          status:'error',   error:'Missing SKU Code and Location' },
  { id:4, row:4, skuCode:'SKU-1001', skuName:'Paracetamol 500mg',   location:'Rack A1 - Zone 1', qty:50,   expiry:'2026-12-31', status:'warning', error:'Duplicate SKU detected' },
  { id:5, row:5, skuCode:'SKU-1018', skuName:'Bandage Roll',        location:'Rack C2 - Zone 3', qty:500,  expiry:'2028-03-15', status:'valid',   error:null },
]

const REQUIRED_COLS = ['SKU Code', 'SKU Name', 'Location', 'Quantity', 'Expiry Date']

/* ── Tabs ─────────────────────────────────────────────── */
const TABS = ['Upload', 'Validation', 'History', 'Compare']

export default function DataUpload() {
  const { showToast } = useApp()
  const fileRef = useRef()

  const [activeTab, setActiveTab]       = useState('Upload')
  const [step, setStep]                 = useState('idle') // idle | preview | importing | done
  const [fileName, setFileName]         = useState('')
  const [dragging, setDragging]         = useState(false)
  const [history, setHistory]           = useState(BASE_HISTORY)
  const [selectedVersion, setSelectedVersion] = useState(null)

  // Editable validation
  const [validRows, setValidRows]       = useState(INITIAL_VALIDATION_ROWS)
  const [editingCell, setEditingCell]   = useState(null) // { rowId, field }
  const [editValue, setEditValue]       = useState('')

  // Compare
  const [compareFrom, setCompareFrom]   = useState('V2')
  const [compareTo, setCompareTo]       = useState('V3')

  /* ── File handling ─────────────────────────────────── */
  const handleFile = file => {
    if (!file) return
    if (!file.name.match(/\.(csv|xlsx|xls)$/i)) { showToast('Please upload a CSV or Excel file', 'error'); return }
    setFileName(file.name)
    setStep('preview')
    setActiveTab('Validation')
  }

  const handleImport = () => {
    setStep('importing')
    setTimeout(() => {
      setStep('done')
      const newVersion = { id: history.length + 1, version: `V${history.length + 1}`, filename: fileName, records:5, success:4, errors:1, uploadedAt: new Date().toLocaleString('en-IN').slice(0,16), status:'Completed' }
      setHistory(prev => [...prev, newVersion])
      showToast(`4 records imported as ${newVersion.version}`, 'success')
    }, 2200)
  }

  const reset = () => { setStep('idle'); setFileName(''); setActiveTab('Upload') }

  /* ── Inline edit ───────────────────────────────────── */
  const startEdit = (rowId, field, value) => {
    setEditingCell({ rowId, field })
    setEditValue(String(value))
  }

  const commitEdit = () => {
    if (!editingCell) return
    setValidRows(prev => prev.map(r => {
      if (r.id !== editingCell.rowId) return r
      return { ...r, [editingCell.field]: editValue }
    }))
    setEditingCell(null)
  }

  const revalidateRow = rowId => {
    setValidRows(prev => prev.map(r => {
      if (r.id !== rowId) return r
      const hasErrors = !r.skuCode || !r.location || !r.qty
      return { ...r, status: hasErrors ? 'error' : 'valid', error: hasErrors ? 'Missing required fields' : null }
    }))
    showToast('Row revalidated', 'success')
  }

  const validCount   = validRows.filter(r => r.status === 'valid').length
  const warningCount = validRows.filter(r => r.status === 'warning').length
  const errorCount   = validRows.filter(r => r.status === 'error').length

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>Data Upload</h2>
          <p>Upload, validate, version-compare inventory data files</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm">
            <Download size={14} /> Download Template
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {TABS.map(t => (
          <button
            key={t}
            className={`${styles.tab} ${activeTab === t ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t === 'Upload'   && <Upload size={13}/>}
            {t === 'Validation' && <CheckCircle size={13}/>}
            {t === 'History'  && <History size={13}/>}
            {t === 'Compare'  && <GitCompare size={13}/>}
            {t}
          </button>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────── */}
      {/* Tab: Upload                                           */}
      {/* ─────────────────────────────────────────────────────── */}
      {activeTab === 'Upload' && (
        <>
          {step === 'idle' && (
            <div
              className={`card ${styles.dropZone} ${dragging ? styles.dragging : ''}`}
              onDragOver={e=>{ e.preventDefault(); setDragging(true) }}
              onDragLeave={()=>setDragging(false)}
              onDrop={e=>{ e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display:'none' }} onChange={e=>handleFile(e.target.files[0])}/>
              <div className={styles.dropIcon}><Upload size={36}/></div>
              <div className={styles.dropText}>
                <h3>Drag & drop your file here</h3>
                <p>or click to browse — .CSV, .XLSX, .XLS supported</p>
              </div>
              <p className={styles.dropHint}>Maximum file size: 50MB · Once uploaded, data will auto-validate</p>
            </div>
          )}
          {step !== 'idle' && (
            <div className="card">
              <div className="card-header">
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <FileText size={16} style={{ color:'var(--color-primary-light)' }}/>
                  <span style={{ fontWeight:600 }}>{fileName}</span>
                </div>
                {step === 'preview' && <button className="btn btn-ghost btn-sm" onClick={reset}><X size={14}/> Cancel</button>}
              </div>
              {step === 'done' ? (
                <div className={styles.successBanner}>
                  <CheckCircle size={20} color="var(--color-success)"/>
                  <span>Import complete! <strong>4 records</strong> added. <strong>1 error</strong> skipped.</span>
                  <button className="btn btn-secondary btn-sm" onClick={reset}>Upload Another</button>
                </div>
              ) : step === 'importing' ? (
                <div className={styles.importingBar}>
                  <div className={styles.importSpinner}/>
                  <span>Importing records... please wait</span>
                </div>
              ) : (
                <div className={styles.importActions}>
                  <button className="btn btn-secondary" onClick={reset}><X size={14}/> Cancel</button>
                  <button className="btn btn-primary" onClick={handleImport}>
                    <Upload size={14}/> Import {validCount + warningCount} Valid Records
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ─────────────────────────────────────────────────────── */}
      {/* Tab: Validation (editable workspace)                  */}
      {/* ─────────────────────────────────────────────────────── */}
      {activeTab === 'Validation' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Validation Workspace</span>
            <span className="badge badge-info">Click any cell to edit</span>
          </div>

          {/* Validation summary */}
          <div className={styles.validationRow}>
            {[
              { icon:<CheckCircle size={15}/>, label:'Valid',    count:validCount,   color:'var(--color-success)' },
              { icon:<AlertTriangle size={15}/>,label:'Warnings', count:warningCount, color:'var(--color-warning)' },
              { icon:<X size={15}/>,            label:'Errors',   count:errorCount,   color:'var(--color-danger)'  },
              { icon:<FileText size={15}/>,      label:'Total',    count:validRows.length, color:'var(--color-text-muted)' },
            ].map(s => (
              <div key={s.label} className={styles.validStat} style={{ borderColor:s.color }}>
                <span style={{ color:s.color }}>{s.icon}</span>
                <span className={styles.validNum} style={{ color:s.color }}>{s.count}</span>
                <span className={styles.validLabel}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Editable table */}
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>SKU Code</th>
                  <th>SKU Name</th>
                  <th>Location</th>
                  <th>Qty</th>
                  <th>Expiry</th>
                  <th>Validation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {validRows.map(row => {
                  const isError = row.status === 'error'
                  return (
                    <tr key={row.id} style={{ background: isError ? 'rgba(239,68,68,0.04)' : row.status==='warning' ? 'rgba(245,158,11,0.04)' : '' }}>
                      <td className="text-muted">{row.row}</td>
                      {['skuCode','skuName','location','qty','expiry'].map(field => (
                        <td key={field} onClick={() => startEdit(row.id, field, row[field])}>
                          {editingCell?.rowId === row.id && editingCell?.field === field ? (
                            <input
                              autoFocus
                              className={`form-input ${styles.inlineInput}`}
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={e => { if (e.key==='Enter') commitEdit(); if (e.key==='Escape') setEditingCell(null) }}
                            />
                          ) : (
                            <span className={`${styles.editableCell} ${!row[field] ? styles.missingCell : ''}`}>
                              {row[field] || <span style={{ color:'var(--color-danger)', fontSize:11 }}>— empty —</span>}
                              <Edit3 size={10} className={styles.editIcon}/>
                            </span>
                          )}
                        </td>
                      ))}
                      <td>
                        {row.status === 'error'
                          ? <span className="badge badge-danger">{row.error}</span>
                          : row.status === 'warning'
                            ? <span className="badge badge-warning">{row.error}</span>
                            : <span className="badge badge-success">✓ Valid</span>
                        }
                      </td>
                      <td>
                        {row.status !== 'valid' && (
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding:'3px 8px', fontSize:11 }}
                            onClick={() => revalidateRow(row.id)}
                          >
                            <RotateCcw size={10}/> Revalidate
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop:12, display:'flex', justifyContent:'flex-end', gap:8 }}>
            <button className="btn btn-primary" onClick={handleImport} disabled={errorCount === validRows.length}>
              <Upload size={14}/> Import {validCount + warningCount} Records
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────── */}
      {/* Tab: History                                          */}
      {/* ─────────────────────────────────────────────────────── */}
      {activeTab === 'History' && (
        <div style={{ display:'grid', gridTemplateColumns:'260px 1fr', gap:16 }}>
          <div className="card" style={{ padding:0 }}>
            <div className="card-header" style={{ padding:'12px 16px' }}>
              <span className="card-title">Upload Versions</span>
            </div>
            <div>
              {history.map(h => (
                <button
                  key={h.id}
                  className={`${styles.versionBtn} ${selectedVersion?.id===h.id?styles.versionBtnActive:''}`}
                  onClick={() => setSelectedVersion(h)}
                >
                  <div className={styles.versionBadge}>{h.version}</div>
                  <div className={styles.versionInfo}>
                    <div style={{ fontWeight:500, fontSize:13 }}>{h.filename}</div>
                    <div style={{ fontSize:11, color:'var(--color-text-muted)' }}>{h.uploadedAt}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            {selectedVersion ? (
              <>
                <div className="card-header">
                  <span className="card-title">{selectedVersion.version} — {selectedVersion.filename}</span>
                  <span className="badge badge-success">{selectedVersion.status}</span>
                </div>
                <div className="grid-4" style={{ gap:12, marginBottom:16 }}>
                  {[
                    { label:'Total Records', val:selectedVersion.records, color:'var(--color-primary)' },
                    { label:'Successful',    val:selectedVersion.success, color:'var(--color-success)' },
                    { label:'Errors',        val:selectedVersion.errors,  color:'var(--color-danger)'  },
                    { label:'Success Rate',  val:`${Math.round((selectedVersion.success/selectedVersion.records)*100)}%`, color:'var(--color-info)' },
                  ].map(s=>(
                    <div key={s.label} className="card" style={{ textAlign:'center', padding:14 }}>
                      <div style={{ fontSize:22, fontWeight:800, color:s.color }}>{s.val}</div>
                      <div style={{ fontSize:11, color:'var(--color-text-muted)', marginTop:3 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {[['File', selectedVersion.filename],['Uploaded At', selectedVersion.uploadedAt],['Status', selectedVersion.status],['Version', selectedVersion.version]].map(([k,v])=>(
                    <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--color-border)' }}>
                      <span className="text-sm text-muted">{k}</span>
                      <span className="text-sm font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <History size={32}/><p>Select a version from the left to view its summary</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────── */}
      {/* Tab: Compare                                          */}
      {/* ─────────────────────────────────────────────────────── */}
      {activeTab === 'Compare' && (
        <div>
          <div className="card" style={{ marginBottom:14, padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
            <span className="text-sm font-medium">Compare:</span>
            <select className="form-select" style={{ width:140 }} value={compareFrom} onChange={e=>setCompareFrom(e.target.value)}>
              {history.map(h=><option key={h.id} value={h.version}>{h.version} — {h.filename.slice(0,20)}</option>)}
            </select>
            <span className="text-muted">→</span>
            <select className="form-select" style={{ width:140 }} value={compareTo} onChange={e=>setCompareTo(e.target.value)}>
              {history.map(h=><option key={h.id} value={h.version}>{h.version} — {h.filename.slice(0,20)}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={()=>showToast(`Comparing ${compareFrom} vs ${compareTo}`, 'info')}>
              <GitCompare size={13}/> Compare
            </button>
          </div>

          {/* Comparison summary */}
          <div className="grid-4" style={{ marginBottom:14 }}>
            {[
              { label:'New SKUs',       val:COMPARE_SUMMARY.newSKUs,       color:'var(--color-success)' },
              { label:'Removed SKUs',   val:COMPARE_SUMMARY.removedSKUs,   color:'var(--color-danger)'  },
              { label:'Qty Increased',  val:COMPARE_SUMMARY.qtyIncreased,  color:'var(--color-info)'    },
              { label:'Qty Decreased',  val:COMPARE_SUMMARY.qtyDecreased,  color:'var(--color-warning)' },
            ].map(s=>(
              <div key={s.label} className="card" style={{ textAlign:'center', padding:'16px 12px' }}>
                <div style={{ fontSize:28, fontWeight:800, color:s.color }}>{s.val}</div>
                <div style={{ fontSize:11, color:'var(--color-text-muted)', marginTop:4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Comparison table */}
          <div className="card" style={{ padding:0 }}>
            <div className="card-header" style={{ padding:'12px 16px' }}>
              <span className="card-title">SKU-level Comparison ({compareFrom} vs {compareTo})</span>
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU Code</th>
                    <th>SKU Name</th>
                    <th>Previous Qty ({compareFrom})</th>
                    <th>Current Qty ({compareTo})</th>
                    <th>Difference</th>
                    <th>Location Change</th>
                    <th>Change Type</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_DATA.map(r=>{
                    const isNew     = r.prevQty === null
                    const isRemoved = r.curQty === null
                    const diff      = isNew ? null : isRemoved ? null : r.curQty - r.prevQty

                    return (
                      <tr key={r.skuCode}>
                        <td><code style={{ fontFamily:'monospace', fontSize:12, color:'var(--color-primary)' }}>{r.skuCode}</code></td>
                        <td style={{ fontSize:13 }}>{r.skuName}</td>
                        <td style={{ color: isNew ? 'var(--color-text-muted)' : '' }}>{isNew ? '—' : r.prevQty}</td>
                        <td style={{ color: isRemoved ? 'var(--color-text-muted)' : '' }}>{isRemoved ? '—' : r.curQty}</td>
                        <td>
                          {diff !== null && (
                            <span style={{ fontWeight:700, color:diff>0?'var(--color-success)':diff<0?'var(--color-danger)':'var(--color-text-muted)' }}>
                              {diff>0?'+':''}{diff}
                            </span>
                          )}
                        </td>
                        <td>{r.locChange ? <span className="badge badge-warning">Changed</span> : <span className="badge badge-default">No Change</span>}</td>
                        <td>
                          {isNew     && <span className="badge badge-success">New SKU</span>}
                          {isRemoved && <span className="badge badge-danger">Removed</span>}
                          {!isNew && !isRemoved && diff > 0  && <span className="badge badge-info">Increased</span>}
                          {!isNew && !isRemoved && diff < 0  && <span className="badge badge-warning">Decreased</span>}
                          {!isNew && !isRemoved && diff === 0 && <span className="badge badge-default">No Change</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
