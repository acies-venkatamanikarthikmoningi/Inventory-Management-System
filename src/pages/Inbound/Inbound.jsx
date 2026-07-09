import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckSquare, ChevronRight, FileText, PackageCheck, Plus, Sparkles, Upload, X, Zap } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import Drawer from '../../components/Drawer/Drawer'
import skuData from '../../data/sku.json'
import styles from './Inbound.module.css'

const CASES_PER_PALLET = 40
const VALID_UOMS = ['Each', 'Pack', 'Case', 'L0', 'L1', 'L2']

const SAMPLE_UPLOAD_ROWS = [
  { skuCode: 'SKU-2003', uom: 'Case', batch: 'BCH-UPL-701', mfgDate: '2026-06-28', qty: 500 },
  { skuCode: 'SKU-2007', uom: 'L1', batch: 'BCH-UPL-702', mfgDate: '2026-06-26', qty: 300 },
  { skuCode: 'SKU-2050', uom: 'Each', batch: 'BCH-UPL-703', mfgDate: '2026-06-25', qty: 250 },
]

const emptyLine = {
  skuCode: 'SKU-2003',
  uom: 'Case',
  batch: '',
  mfgDate: new Date().toISOString().slice(0, 10),
  qty: 100,
}

const normalizeUom = uom => VALID_UOMS.includes(uom) ? uom : 'Each'
const resolveSkuLocation = (items, node, skuCode) => items.find(item => item.node === node && item.skuCode === skuCode)?.location || 'RESERVE-01 - Zone 1'
const getBinFromLocation = location => location?.split(' - ')[0] || 'RESERVE-01'
const statusClass = status => status === 'Pending' ? 'badge-warning' : 'badge-success'
const formatDate = value => new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const sourceLabel = source => ({ manual_upload: 'Upload', manual_create: 'Created', auto: 'Auto ASN' }[source] || source)
const formatStock = cases => {
  const safeCases = Math.max(CASES_PER_PALLET, Number(cases || 0))
  return `${(safeCases / CASES_PER_PALLET).toFixed(1)} pallets (${safeCases.toLocaleString('en-IN')} cases)`
}
const roundToPallet = cases => Math.max(CASES_PER_PALLET, Math.ceil(Number(cases || 0) / CASES_PER_PALLET) * CASES_PER_PALLET)

const getExpiry = mfgDate => {
  const d = new Date(mfgDate)
  d.setMonth(d.getMonth() + 12)
  return d.toISOString().slice(0, 10)
}

export default function Inbound() {
  const { node, showToast, inventoryData, setInventoryData, asns, setAsns } = useApp()
  const fileRef = useRef(null)
  const activeNode = node || 'Chennai Distribution Center'

  const [activeView, setActiveView] = useState('landing')
  const [asnMode, setAsnMode] = useState('upload')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [createLines, setCreateLines] = useState([{ ...emptyLine }])
  const [selectedAuto, setSelectedAuto] = useState(new Set())
  const [receivingAsn, setReceivingAsn] = useState(null)

  const skuMap = useMemo(() => {
    const map = new Map()
    skuData.forEach(sku => map.set(sku.skuCode, sku))
    inventoryData.forEach(item => {
      if (!map.has(item.skuCode)) map.set(item.skuCode, item)
    })
    return map
  }, [inventoryData])

  const uniqueSkus = useMemo(() => [...skuMap.values()].sort((a, b) => a.skuCode.localeCompare(b.skuCode)), [skuMap])

  const recentAsns = useMemo(() => [...asns].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [asns])

  const lowStockRows = useMemo(() => {
    const totals = new Map()
    inventoryData
      .filter(item => item.node === activeNode)
      .forEach(item => {
        const current = totals.get(item.skuCode) || {
          skuCode: item.skuCode,
          skuName: item.skuName,
          availableQty: 0,
          reorderPoint: skuMap.get(item.skuCode)?.reorderPoint || 1000,
          uom: normalizeUom(skuMap.get(item.skuCode)?.uom || item.uom || 'Case'),
        }
        current.availableQty += Number(item.availableQty || 0)
        totals.set(item.skuCode, current)
      })

    return [...totals.values()]
      .filter(row => row.availableQty <= row.reorderPoint)
      .map((row, index) => {
        const currentQty = Math.max(CASES_PER_PALLET, Number(row.availableQty || 0))
        const ropQty = Math.max(CASES_PER_PALLET * 2, Number(row.reorderPoint || 0))
        const addPrior = 24 + (index * 7)
        const add = addPrior + 11 + (index * 3)
        const suggestedQty = roundToPallet(Math.max(ropQty * 1.5, currentQty + add * 7))
        return { ...row, currentQty, ropQty, add, addPrior, suggestedQty }
      })
      .sort((a, b) => a.availableQty - b.availableQty)
  }, [activeNode, inventoryData, skuMap])

  const nextAsnId = () => {
    const max = asns.reduce((acc, asn) => Math.max(acc, Number(asn.id.replace('ASN-', '')) || 0), 1000)
    return `ASN-${max + 1}`
  }

  const addAsn = (source, lines, toastMessage) => {
    const id = nextAsnId()
    const hydratedLines = lines.map(line => {
      const sku = skuMap.get(line.skuCode)
      return {
        skuCode: line.skuCode,
        skuName: sku?.skuName || line.skuName || line.skuCode,
        uom: normalizeUom(line.uom),
        batch: line.batch || `BCH-${id.replace('ASN-', '')}`,
        mfgDate: line.mfgDate,
        qty: Number(line.qty || 0),
      }
    })
    setAsns(prev => [{
      id,
      source,
      status: 'Pending',
      node: activeNode,
      createdAt: new Date().toISOString(),
      lines: hydratedLines,
      receivedAt: null,
      grnNumber: null,
    }, ...prev])
    showToast(toastMessage?.(id, hydratedLines.length) || `ASN ${id} created with ${hydratedLines.length} line items`, 'success')
    setActiveView('landing')
    setFileName('')
    setCreateLines([{ ...emptyLine }])
  }

  const handleFile = file => {
    if (!file) return
    if (!file.name.match(/\.(csv|xlsx|xls)$/i)) {
      showToast('Please upload a CSV or Excel file', 'error')
      return
    }
    setFileName(file.name)
    showToast('ASN file parsed for preview', 'success')
  }

  const updateLine = (index, field, value) => {
    setCreateLines(prev => prev.map((line, i) => {
      if (i !== index) return line
      if (field === 'skuCode') {
        return { ...line, skuCode: value, uom: normalizeUom(skuMap.get(value)?.uom) }
      }
      return { ...line, [field]: value }
    }))
  }

  const openReceive = asn => {
    setReceivingAsn(asn)
  }

  const submitGrn = () => {
    if (!receivingAsn) return
    const grnNumber = `GRN-${receivingAsn.id.replace('ASN-', '')}`
    const now = new Date().toISOString()
    const totalQty = receivingAsn.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0)

    setInventoryData(prev => {
      const next = [...prev]
      receivingAsn.lines.forEach((line, index) => {
        const location = resolveSkuLocation(prev, activeNode, line.skuCode)
        const bin = getBinFromLocation(location)
        const existingIndex = next.findIndex(item =>
          item.node === activeNode &&
          item.skuCode === line.skuCode &&
          item.batch === line.batch &&
          getBinFromLocation(item.location) === bin
        )
        if (existingIndex >= 0) {
          const current = next[existingIndex]
          next[existingIndex] = {
            ...current,
            availableQty: Number(current.availableQty || 0) + Number(line.qty || 0),
            onHandQty: Number(current.onHandQty || current.availableQty || 0) + Number(line.qty || 0),
            status: 'Healthy',
          }
          return
        }

        const sku = skuMap.get(line.skuCode) || {}
        const template = prev.find(item => item.skuCode === line.skuCode) || {}
        next.push({
          id: `INV-GRN-${receivingAsn.id.replace('ASN-', '')}-${index + 1}`,
          skuCode: line.skuCode,
          skuName: sku.skuName || line.skuName,
          location,
          node: activeNode,
          classification: sku.classification || template.classification || 'Medium Moving',
          batch: line.batch,
          onHandQty: Number(line.qty || 0),
          inTransitQty: 0,
          availableQty: Number(line.qty || 0),
          reservedQty: 0,
          status: 'Healthy',
          bucket: 'Good',
          expiry: getExpiry(line.mfgDate),
          mfgDate: line.mfgDate,
          uom: normalizeUom(line.uom),
          brand: sku.brand || template.brand || 'Supplier',
          category: sku.category || template.category || 'General',
          shelfLife: sku.shelfLife || template.shelfLife || 12,
          storageCondition: sku.storageCondition || template.storageCondition || 'Room Temperature',
        })
      })
      return next
    })

    setAsns(prev => prev.map(asn => asn.id === receivingAsn.id ? {
      ...asn,
      status: 'Received (GRN Submitted)',
      receivedAt: now,
      grnNumber,
    } : asn))
    setReceivingAsn(null)
    showToast(`GRN ${grnNumber} submitted - inventory updated (+${totalQty} units across ${receivingAsn.lines.length} SKUs)`, 'success')
    setTimeout(() => showToast('Notification email sent to warehouse team', 'info'), 800)
  }

  const toggleAutoRow = skuCode => {
    setSelectedAuto(prev => {
      const next = new Set(prev)
      next.has(skuCode) ? next.delete(skuCode) : next.add(skuCode)
      return next
    })
  }

  const toggleAllAuto = () => {
    setSelectedAuto(prev => prev.size === lowStockRows.length ? new Set() : new Set(lowStockRows.map(row => row.skuCode)))
  }

  const generateAutoAsn = () => {
    const selectedRows = lowStockRows.filter(row => selectedAuto.has(row.skuCode))
    const stamp = Date.now()
    addAsn('auto', selectedRows.map(row => ({
      skuCode: row.skuCode,
      skuName: row.skuName,
      uom: normalizeUom(row.uom),
      batch: `BCH-AUTO-${stamp}-${row.skuCode}`,
      mfgDate: new Date().toISOString().slice(0, 10),
      qty: row.suggestedQty,
    })), (id, count) => `Auto ASN ${id} generated for ${count} SKUs`)
    setSelectedAuto(new Set())
  }

  if (activeView === 'asn') {
    return (
      <div>
        <div className="page-header">
          <div className="page-header-left">
            <button className="btn btn-ghost btn-sm" onClick={() => setActiveView('landing')}><ArrowLeft size={14} /> Back</button>
            <h2>ASN</h2>
            <p>Upload or create an Advance Shipping Note</p>
          </div>
        </div>

        <div className={styles.tabBar}>
          {['upload', 'create'].map(tab => (
            <button key={tab} className={`${styles.tab} ${asnMode === tab ? styles.tabActive : ''}`} onClick={() => setAsnMode(tab)}>
              {tab === 'upload' ? <Upload size={13} /> : <Plus size={13} />}
              {tab === 'upload' ? 'Upload ASN' : 'Create ASN'}
            </button>
          ))}
        </div>

        {asnMode === 'upload' ? (
          <>
            <div
              className={`card ${styles.dropZone} ${dragging ? styles.dragging : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              <div className={styles.dropIcon}><Upload size={36} /></div>
              <div className={styles.dropText}>
                <h3>Drag & drop your ASN file here</h3>
                <p>or click to browse - .CSV, .XLSX, .XLS supported</p>
              </div>
              <p className={styles.dropHint}>Maximum file size: 50MB. Preview is simulated for the demo.</p>
            </div>

            {fileName && (
              <div className={`card ${styles.previewCard}`}>
                <div className="card-header">
                  <span className="card-title">{fileName}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setFileName('')}><X size={14} /> Clear</button>
                </div>
                <LinePreview rows={SAMPLE_UPLOAD_ROWS} skuMap={skuMap} />
                <div className={styles.formActions}>
                  <button className="btn btn-primary" onClick={() => addAsn('manual_upload', SAMPLE_UPLOAD_ROWS)}>
                    <PackageCheck size={14} /> Submit ASN
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="card">
            <div className={styles.lineStack}>
              {createLines.map((line, index) => (
                <div key={index} className={styles.lineItemRow}>
                  <select className="form-select" value={line.skuCode} onChange={e => updateLine(index, 'skuCode', e.target.value)}>
                    {uniqueSkus.map(sku => <option key={sku.skuCode} value={sku.skuCode}>{sku.skuCode} - {sku.skuName}</option>)}
                  </select>
                  <select className="form-select" value={line.uom} onChange={e => updateLine(index, 'uom', e.target.value)}>
                    {VALID_UOMS.map(uom => <option key={uom}>{uom}</option>)}
                  </select>
                  <div className={styles.batchField}>
                    <input className="form-input" placeholder="Batch" value={line.batch} onChange={e => updateLine(index, 'batch', e.target.value)} />
                    <span>As printed on the manufacturer's shipment/batch label</span>
                  </div>
                  <input className="form-input" type="date" value={line.mfgDate} onChange={e => updateLine(index, 'mfgDate', e.target.value)} />
                  <input className="form-input" type="number" min="1" value={line.qty} onChange={e => updateLine(index, 'qty', e.target.value)} />
                  <button className="btn btn-ghost btn-sm" onClick={() => setCreateLines(prev => prev.filter((_, i) => i !== index))} disabled={createLines.length === 1}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.formActions}>
              <button className="btn btn-secondary" onClick={() => setCreateLines(prev => [...prev, { ...emptyLine }])}><Plus size={14} /> Add Line</button>
              <button className="btn btn-primary" onClick={() => addAsn('manual_create', createLines)}><PackageCheck size={14} /> Submit ASN</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (activeView === 'autoAsn') {
    return (
      <div>
        <div className="page-header">
          <div className="page-header-left">
            <button className="btn btn-ghost btn-sm" onClick={() => setActiveView('landing')}><ArrowLeft size={14} /> Back</button>
            <h2>Auto ASN</h2>
            <p>System-suggested replenishment for low-stock SKUs</p>
          </div>
        </div>
        <div className={`card ${styles.autoPanel}`}>
          <div className={styles.autoHeader}>
            <label className={styles.selectAll}>
              <input type="checkbox" checked={lowStockRows.length > 0 && selectedAuto.size === lowStockRows.length} onChange={toggleAllAuto} />
              Select All
            </label>
            <span className="badge badge-warning">{lowStockRows.length} below ROP</span>
          </div>
          <div className={styles.autoList}>
            {lowStockRows.map(row => (
              <label key={row.skuCode} className={styles.autoRow}>
                <input type="checkbox" checked={selectedAuto.has(row.skuCode)} onChange={() => toggleAutoRow(row.skuCode)} />
                <div className={styles.autoContent}>
                  <div className={styles.stockLine}><code>{row.skuCode}</code> <strong>{row.skuName}</strong> <span className={styles.uomPill}>{row.uom}</span></div>
                  <div className={styles.stockLine}>Current: {formatStock(row.currentQty)} - below ROP of {formatStock(row.ropQty)}</div>
                  <div className={styles.demandLine}>Demand is rising - {row.add} cases/day, up from {row.addPrior} cases/day</div>
                  <div className={styles.warnLine}>At this rate, you will run out of stock</div>
                  <div className={styles.suggestedLine}>Suggested: {formatStock(row.suggestedQty)}</div>
                </div>
              </label>
            ))}
            {lowStockRows.length === 0 && (
              <div className="empty-state"><CheckSquare size={32} /><p>No low-stock SKUs found for the active node.</p></div>
            )}
          </div>
        </div>
        <div className={styles.stickyFooter}>
          <button className="btn btn-primary" disabled={selectedAuto.size === 0} onClick={generateAutoAsn}>
            <Sparkles size={14} /> Generate ASN from Selected ({selectedAuto.size})
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>Inbound</h2>
          <p>Manage incoming shipments via ASN and Auto ASN</p>
        </div>
      </div>

      <div className={styles.optionGrid}>
        <button className={`card ${styles.optionCard}`} onClick={() => setActiveView('asn')}>
          <div className={styles.optionHeader}><FileText size={20} /><span>ASN</span></div>
          <p>Upload or create an Advance Shipping Note</p>
          <div className={styles.optionFooter}><span>Open ASN workspace</span><ChevronRight size={14} /></div>
        </button>
        <button className={`card ${styles.optionCard}`} onClick={() => setActiveView('autoAsn')}>
          <div className={styles.optionHeader}><Zap size={20} /><span>Auto ASN</span></div>
          <p>System-suggested replenishment based on low stock</p>
          <div className={styles.optionFooter}><span>Review suggestions</span><ChevronRight size={14} /></div>
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className={styles.tableHeader}>
          <span className="card-title">Recent ASNs</span>
          <span className="badge badge-info">{recentAsns.length} records</span>
        </div>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>ASN ID</th>
                <th>Status</th>
                <th>Source</th>
                <th>Line Count</th>
                <th>Total Qty</th>
                <th>Created Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {recentAsns.map(asn => (
                <tr key={asn.id}>
                  <td><code>{asn.id}</code></td>
                  <td><span className={`badge ${statusClass(asn.status)}`}>{asn.status}</span></td>
                  <td><span className="badge badge-default">{sourceLabel(asn.source)}</span></td>
                  <td>{asn.lines.length}</td>
                  <td><strong>{asn.lines.reduce((sum, line) => sum + line.qty, 0).toLocaleString()}</strong></td>
                  <td>{formatDate(asn.createdAt)}</td>
                  <td>
                    {asn.status === 'Pending' ? (
                      <button className="btn btn-primary btn-sm" onClick={() => openReceive(asn)}>Receive / GRN</button>
                    ) : (
                      <span className="text-xs text-muted">{asn.grnNumber}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer open={Boolean(receivingAsn)} onClose={() => setReceivingAsn(null)} title={`Receive Inbound - ${receivingAsn?.id || ''}`} subtitle="Goods Receipt Note submission" width={760}>
        {receivingAsn && (
          <div>
            <div className={styles.processBreadcrumb}>
              {['Receiving', 'Palletize', 'Putaway', 'GRN'].map(step => (
                <span key={step} className={`${styles.processStep} ${step === 'GRN' ? styles.processStepActive : ''}`}>{step}</span>
              ))}
            </div>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Batch</th>
                    <th>UOM</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {receivingAsn.lines.map(line => (
                    <tr key={`${line.skuCode}-${line.batch}`}>
                      <td><div className={styles.skuCell}><code>{line.skuCode}</code><span>{line.skuName}</span></div></td>
                      <td>{line.batch}</td>
                      <td>{normalizeUom(line.uom)}</td>
                      <td><strong>{line.qty.toLocaleString()}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.drawerFooter}>
              <button className="btn btn-secondary" onClick={() => setReceivingAsn(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitGrn}><PackageCheck size={14} /> Submit GRN</button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

function LinePreview({ rows, skuMap }) {
  return (
    <div className="table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>SKU Code</th>
            <th>SKU Name</th>
            <th>UOM</th>
            <th>Batch</th>
            <th>Manufacturing Date</th>
            <th>Quantity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.batch}>
              <td><code>{row.skuCode}</code></td>
              <td>{skuMap.get(row.skuCode)?.skuName || row.skuCode}</td>
              <td>{normalizeUom(row.uom)}</td>
              <td>{row.batch}</td>
              <td>{row.mfgDate}</td>
              <td><strong>{row.qty.toLocaleString()}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
