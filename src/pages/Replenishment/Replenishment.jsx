import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { ArrowRight, CheckCircle, ChevronDown, ChevronUp, RefreshCw, Save, Search, X } from 'lucide-react'
import skuData from '../../data/sku.json'
import { CASES_TO_EACHES, EACHES_PER_PALLET, getDriftUomDisplay, getInventoryUomSimulation } from '../../utils/uomDisplay'
import { normalizeNode } from '../../utils/replenishmentStatus'
import styles from './Replenishment.module.css'

const PARAMETER_DRIFT = [
  {
    id: 'PD-001',
    metric: 'Safety Stock',
    skuCode: 'SKU-2003',
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
    skuCode: 'SKU-2027',
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
    skuCode: 'SKU-2037',
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

const TABS = [
  { id: 'config', label: 'Replenishment' },
  { id: 'auto', label: 'Auto-Replenishment' },
  { id: 'drift', label: 'Parameter Drift' },
]

const metricCodes = { 'Safety Stock': 'SS', 'Reorder Point': 'ROP', 'Maximum Stock Level': 'MAX' }
const formatNumber = value => Number(value || 0).toLocaleString('en-IN')
const getDriftPriority = item => item.driftDirection === 'down' ? 'Medium' : 'High'
const getDriftBadgeClass = item => item.driftDirection === 'down' ? 'badge-warning' : 'badge-danger'
const ACTIVE_ASN_STATUSES = new Set(['Pending', 'Received (GRN Submitted)'])
const APPROVED_STATUS = 'Approved — Sent to Inbound'

const convertBaseEachesToUom = (baseEaches, uom) => {
  if (uom === 'Pallet') return baseEaches / EACHES_PER_PALLET
  if (uom === 'Case') return baseEaches / CASES_TO_EACHES
  return baseEaches
}

const formatQty = value => {
  return Math.round(Number(value || 0)).toLocaleString('en-IN')
}

const hasActiveAsn = (asns, row, node) => asns.some(asn => {
  if (!ACTIVE_ASN_STATUSES.has(asn.status)) return false
  if (asn.node && normalizeNode(asn.node) !== normalizeNode(node)) return false
  return asn.lines?.some(line => line.skuCode === row.skuCode)
})

const nextAsnId = asns => {
  const max = asns.reduce((acc, asn) => Math.max(acc, Number(String(asn.id).replace('ASN-', '')) || 0), 1000)
  return `ASN-${max + 1}`
}

const buildAsn = (row, node, id) => ({
  id,
  source: 'auto',
  status: 'Pending',
  node,
  createdAt: new Date().toISOString(),
  lines: [{
    skuCode: row.skuCode,
    skuName: row.skuName,
    uom: row.uom,
    batch: `BCH-AUTO-${id.replace('ASN-', '')}-${row.skuCode}`,
    mfgDate: new Date().toISOString().slice(0, 10),
    qty: row.suggestedQty,
  }],
  receivedAt: null,
  grnNumber: null,
})

export default function Replenishment() {
  const { showToast, node, inventoryData, asns, setAsns, replenishmentConfig, setReplenishmentConfig } = useApp()
  const navigate = useNavigate()
  const activeNode = normalizeNode(node)
  const [activeTab, setActiveTab] = useState('config')
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [expanded, setExpanded] = useState(new Set())
  const [editingKey, setEditingKey] = useState('')
  const [editDraft, setEditDraft] = useState({ min: '', max: '' })
  const [approved, setApproved] = useState(new Set())
  const [autoCreated, setAutoCreated] = useState(new Set())

  const skuMap = useMemo(() => new Map(skuData.map(sku => [sku.skuCode, sku])), [])

  const inventoryBaseQtyBySku = useMemo(() => {
    const totals = new Map()
    inventoryData
      .filter(item => item.node === activeNode)
      .forEach(item => {
        const simulation = getInventoryUomSimulation(item)
        totals.set(item.skuCode, (totals.get(item.skuCode) || 0) + Number(simulation.qtyInBaseUom || 0))
      })
    return totals
  }, [activeNode, inventoryData])

  const configRows = useMemo(() => replenishmentConfig.map(config => ({
    key: config.skuCode,
    skuCode: config.skuCode,
    skuName: skuMap.get(config.skuCode)?.skuName || config.skuCode,
    node: config.node,
    minQty: config.min,
    maxQty: config.max,
    uom: config.uom,
    autoApprove: config.autoApprove,
  })), [replenishmentConfig, skuMap])

  const filteredConfigRows = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return configRows
    return configRows.filter(row =>
      row.skuCode.toLowerCase().includes(q) ||
      row.skuName.toLowerCase().includes(q) ||
      row.uom.toLowerCase().includes(q)
    )
  }, [configRows, search])

  const breachRows = useMemo(() => configRows
    .map(row => {
      const baseQty = inventoryBaseQtyBySku.get(row.skuCode) || 0
      const currentQty = convertBaseEachesToUom(baseQty, row.uom)
      return {
        ...row,
        currentQty,
        hasAsn: hasActiveAsn(asns, row, activeNode),
        suggestedQty: Math.max(1, Math.ceil(Number(row.maxQty || 0) - currentQty)),
        belowMin: currentQty < Number(row.minQty || 0),
      }
    })
    .filter(row => row.belowMin), [activeNode, asns, configRows, inventoryBaseQtyBySku])

  const visibleBreachRows = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return breachRows
    return breachRows.filter(row =>
      row.skuCode.toLowerCase().includes(q) ||
      row.skuName.toLowerCase().includes(q) ||
      row.uom.toLowerCase().includes(q)
    )
  }, [breachRows, search])

  const driftRows = useMemo(() => {
    const q = search.toLowerCase()
    let data = PARAMETER_DRIFT
    if (q) data = data.filter(i =>
      i.metric.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      i.skuCode.toLowerCase().includes(q) ||
      i.node.toLowerCase().includes(q)
    )
    if (priorityFilter !== 'All') data = data.filter(i => getDriftPriority(i) === priorityFilter)
    return [...data].sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct))
  }, [search, priorityFilter])

  useEffect(() => {
    const rowsToCreate = breachRows.filter(row => row.autoApprove && !row.hasAsn && !autoCreated.has(row.key))
    if (rowsToCreate.length === 0) return

    setAsns(prev => {
      let next = [...prev]
      rowsToCreate.forEach(row => {
        const id = nextAsnId(next)
        next = [buildAsn(row, activeNode, id), ...next]
      })
      return next
    })
    setAutoCreated(prev => new Set([...prev, ...rowsToCreate.map(row => row.key)]))
    showToast(`Auto-Triggered ASN created for ${rowsToCreate.length} replenishment breach${rowsToCreate.length === 1 ? '' : 'es'}`, 'success')
  }, [activeNode, autoCreated, breachRows, setAsns, showToast])

  const startEdit = row => {
    setEditingKey(row.key)
    setEditDraft({ min: row.minQty, max: row.maxQty, uom: row.uom })
  }

  const saveConfig = row => {
    const min = Math.max(0, Math.round(Number(editDraft.min || 0)))
    const max = Math.max(min, Math.round(Number(editDraft.max || min)))
    setReplenishmentConfig(prev => prev.map(config => {
      if (config.skuCode !== row.skuCode) return config
      return {
        ...config,
        min,
        max,
        uom: editDraft.uom || row.uom,
      }
    }))
    setEditingKey('')
    showToast(`${row.skuCode} replenishment settings updated`, 'success')
  }

  const toggleAutoApprove = skuCode => {
    setReplenishmentConfig(prev => prev.map(config =>
      config.skuCode === skuCode ? { ...config, autoApprove: !config.autoApprove } : config
    ))
  }

  const createReplenishmentAsn = row => {
    setAsns(prev => [buildAsn(row, activeNode, nextAsnId(prev)), ...prev])
    setApproved(prev => new Set(prev).add(row.key))
    showToast(`ASN created for ${row.skuCode}`, 'success')
  }

  const toggleExpand = id => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const openSku = skuCode => {
    navigate(`/app/sku-explore?sku=${encodeURIComponent(skuCode)}`)
  }

  const getUomBadgeClass = type => {
    if (type === 'Case') return 'badge-info'
    if (type === 'Pallet') return styles.uomPalletBadge
    return 'badge-warning'
  }

  const DriftValue = ({ value }) => (
    <div className={styles.driftValue}>
      <div className={styles.driftValueMain}>
        <strong>{formatNumber(value.quantity)}</strong>
        <span className={`badge ${getUomBadgeClass(value.type)}`}>{value.label}</span>
      </div>
      <div className={styles.baseUomLine}>({formatNumber(value.qtyInBaseUom)} eaches)</div>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>Replenishment</h2>
          <p>Manage Safety Stock, Reorder Point, and Maximum Stock parameters, and drift monitoring</p>
        </div>
      </div>

      <div className={styles.tabStrip}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={`card ${styles.filterBar}`}>
        <div className={styles.searchWrap}>
          <Search size={15} style={{ color: 'var(--color-text-light)', flexShrink: 0 }}/>
          <input
            className={styles.searchInput}
            placeholder="Search SKU, code, UOM, metric..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {activeTab === 'drift' && (
          <div className={styles.filterSelect}>
            <span className="text-sm text-muted">Priority:</span>
            <select className="form-select" style={{ width: 'auto' }} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
              {['All', 'High', 'Medium'].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        )}
      </div>

      {activeTab === 'config' && (
        <div className={`card ${styles.tableCard}`}>
          <div className={styles.tableHeader}>
            <span className="card-title">Manual Min/Max Configuration</span>
            <span className="badge badge-info">{filteredConfigRows.length} rows</span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU Code</th>
                  <th>SKU Name</th>
                  <th>Min Qty</th>
                  <th>Max Qty</th>
                  <th>UOM</th>
                  <th>Auto-Approve</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredConfigRows.map(row => {
                  const isEditing = editingKey === row.key
                  return (
                    <tr key={row.key}>
                      <td>
                        <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                          <code>{row.skuCode}</code>
                        </button>
                      </td>
                      <td>
                        <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                          <span className={styles.insightType}>{row.skuName}</span>
                        </button>
                      </td>
                      <td>{isEditing ? <input className={styles.qtyInput} type="number" min="0" step="1" value={editDraft.min} onChange={e => setEditDraft(prev => ({ ...prev, min: e.target.value }))}/> : formatQty(row.minQty)}</td>
                      <td>{isEditing ? <input className={styles.qtyInput} type="number" min="0" step="1" value={editDraft.max} onChange={e => setEditDraft(prev => ({ ...prev, max: e.target.value }))}/> : formatQty(row.maxQty)}</td>
                      <td>
                        {isEditing ? (
                          <select className="form-select" value={editDraft.uom} onChange={e => setEditDraft(prev => ({ ...prev, uom: e.target.value }))}>
                            {['Each', 'Case', 'Pallet'].map(uom => <option key={uom}>{uom}</option>)}
                          </select>
                        ) : row.uom}
                      </td>
                      <td>
                        <button className={`${styles.toggleSwitch} ${row.autoApprove ? styles.toggleSwitchOn : ''}`} onClick={() => toggleAutoApprove(row.skuCode)} aria-label="Toggle auto approval">
                          <span />
                        </button>
                      </td>
                      <td>
                        {isEditing ? (
                          <div className={styles.rowActions}>
                            <button className="btn btn-primary btn-sm" onClick={() => saveConfig(row)}><Save size={13}/> Save</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditingKey('')}><X size={13}/> Cancel</button>
                          </div>
                        ) : (
                          <button className="btn btn-secondary btn-sm" onClick={() => startEdit(row)}>Edit</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'auto' && (
        <div className={`card ${styles.tableCard}`}>
          <div className={styles.tableHeader}>
            <span className="card-title">Auto-Replenishment Queue</span>
            <span className="badge badge-warning">{visibleBreachRows.length} below min</span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU Code</th>
                  <th>SKU Name</th>
                  <th>Current Qty</th>
                  <th>Min Qty</th>
                  <th>Max Qty</th>
                  <th>UOM</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleBreachRows.map(row => {
                  const wasApproved = approved.has(row.key)
                  const status = wasApproved
                    ? APPROVED_STATUS
                    : (row.autoApprove || row.hasAsn ? 'Auto-Triggered' : 'Pending Approval')
                  const statusClass = status === APPROVED_STATUS
                    ? 'badge-success'
                    : status === 'Auto-Triggered'
                      ? 'badge-warning'
                      : 'badge-default'
                  return (
                    <tr key={row.key}>
                      <td>
                        <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                          <code>{row.skuCode}</code>
                        </button>
                      </td>
                      <td>
                        <button className={styles.skuLink} onClick={() => openSku(row.skuCode)}>
                          <span className={styles.insightType}>{row.skuName}</span>
                        </button>
                      </td>
                      <td>{formatQty(row.currentQty)}</td>
                      <td>{formatQty(row.minQty)}</td>
                      <td>{formatQty(row.maxQty)}</td>
                      <td>{row.uom}</td>
                      <td><span className={`badge ${statusClass}`}>{status}</span></td>
                      <td>
                        <div className={styles.rowActions}>
                          {status === 'Pending Approval' && (
                            <button className="btn btn-primary btn-sm" onClick={() => createReplenishmentAsn(row)}>
                              Approve
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {visibleBreachRows.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-state"><CheckCircle size={32}/><p>No below-min replenishment breaches for {activeNode}.</p></div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'drift' && (
        <div className={styles.insightList}>
          {driftRows.length === 0 && (
            <div className="empty-state card">
              <CheckCircle size={40}/><h4>No parameter drift found</h4><p>Try changing your SKU or priority filter.</p>
            </div>
          )}
          {driftRows.map(item => {
            const isExpanded = expanded.has(item.id)
            const currentValue = getDriftUomDisplay(item, item.erpValue, 'current')
            const newValue = getDriftUomDisplay(item, item.platformValue, 'new')
            return (
              <div key={item.id} className={`card ${styles.driftCard}`}>
                <div className={styles.insightHeader}>
                  <div className={styles.insightTitle}>
                    <div className={styles.insightIconWrap} style={{ background: 'var(--color-info-light)', color: 'var(--color-primary-light)' }}>
                      <RefreshCw size={16}/>
                    </div>
                    <div>
                      <button className={styles.skuLink} onClick={() => openSku(item.skuCode)}>
                        <span className={styles.insightType}>{item.sku}</span>
                        <code>{item.skuCode}</code>
                      </button>
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
                  <DriftValue value={currentValue} />
                  <ArrowRight size={22} />
                  <DriftValue value={newValue} />
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
                  <span className="text-xs text-muted" style={{ marginLeft: 'auto' }}>{item.id}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
