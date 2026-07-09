import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { ArrowRight, ArrowLeft, Warehouse, TrendingUp, Package, CheckCircle, Truck } from 'lucide-react'
import styles from './NodeSelection.module.css'

/* ─────────────────────────────────────────────────────────
   NODE DATA — structured for future API integration
   cx/cy are percentages (0-100) of the map container width/height
   Based on Wikimedia India_outline.svg viewBox 0 0 500 582
   Real geographic positions mapped to the SVG coordinate space:
     India longitude range: ~68°E – 97°E  (width span ~29°)
     India latitude range:  ~8°N  – 37°N  (height span ~29°)
   ─────────────────────────────────────────────────────── */
const NODES = [
  {
    id: 'MUM-DC',
    name: 'Mumbai Distribution Center',
    city: 'Mumbai',
    type: 'Distribution Center',
    region: 'West',
    // 18.97°N, 72.82°E — west coast; label points left (toward Arabian Sea)
    xPct: 16.8,
    yPct: 60.2,
    labelDir: 'left',
    kpis: {
      utilization: 82,
      activeSKUs: 2210,
      serviceLevel: 98.1,
      otif: 95.6,
    },
  },
  {
    id: 'PUNE-DC',
    name: 'Pune Distribution Center',
    city: 'Pune',
    type: 'Distribution Center',
    region: 'West',
    // 18.52°N, 73.86°E — slightly below Mumbai; label points right to avoid Mumbai's label
    xPct: 20.4,
    yPct: 61.8,
    labelDir: 'right',
    kpis: {
      utilization: 67,
      activeSKUs: 1320,
      serviceLevel: 97.8,
      otif: 96.2,
    },
  },
  {
    id: 'HYD-DC',
    name: 'Hyderabad Distribution Center',
    city: 'Hyderabad',
    type: 'Distribution Center',
    region: 'South',
    // 17.38°N, 78.48°E — central Deccan; label points right
    xPct: 35.8,
    yPct: 63.7,
    labelDir: 'right',
    kpis: {
      utilization: 63,
      activeSKUs: 986,
      serviceLevel: 96.5,
      otif: 94.9,
    },
  },
  {
    id: 'BANG-DC',
    name: 'Bangalore Distribution Center',
    city: 'Bengaluru',
    type: 'Distribution Center',
    region: 'South',
    // 12.97°N, 77.59°E — label points LEFT so it does not overlap with Chennai's label
    xPct: 32.6,
    yPct: 72.2,
    labelDir: 'left',
    kpis: {
      utilization: 70,
      activeSKUs: 1540,
      serviceLevel: 98.6,
      otif: 97.1,
    },
  },
  {
    id: 'CHEN-DC',
    name: 'Chennai Distribution Center',
    city: 'Chennai',
    type: 'Distribution Center',
    region: 'South',
    // 13.08°N, 80.27°E — Bay of Bengal east coast
    // label points RIGHT (toward the coast) — opposite direction from Bengaluru's label
    xPct: 43.5,
    yPct: 72.5,
    labelDir: 'right',
    kpis: {
      utilization: 77,
      activeSKUs: 1842,
      serviceLevel: 98.4,
      otif: 96.8,
    },
  },
]

export default function NodeSelection() {
  const { setNode } = useApp()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(null)
  const [hovered, setHovered] = useState(null)

  const handleContinue = () => {
    if (!selected) return
    setNode(selected.name)
    navigate('/login')
  }

  const utilizationColor = (pct) => {
    if (pct > 80) return '#EF4444'
    if (pct > 65) return '#F59E0B'
    return '#22C55E'
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* Back button */}
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          <ArrowLeft size={15} /> Back
        </button>

        {/* Header */}
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Select Working Node</h1>
            <p className={styles.subtitle}>
              Select a Distribution Center to proceed with authentication
            </p>
          </div>
        </div>

        <div className={styles.mapLayout}>

          {/* ── India Map ─────────────────────────────────── */}
          <div className={styles.mapWrap}>
            <div className={styles.mapLegendRow}>
              <span className={styles.mapLegendLabel}>
                <span className={styles.mapDot} /> Distribution Center
              </span>
              <span className={styles.mapLegendHint}>Click a marker to select</span>
            </div>

            {/* Map container — real India SVG as background, markers overlaid */}
            <div className={styles.mapContainer}>
              {/* Real India outline from Wikimedia Commons (CC BY-SA) */}
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/b/b4/India_outline.svg"
                alt="India outline map"
                className={styles.indiaMapImg}
                draggable={false}
              />

              {/* Marker overlay — uses percentage positioning relative to the container */}
              {NODES.map(node => {
                const isSel = selected?.id === node.id
                const isHov = hovered === node.id

                return (
                  <div
                    key={node.id}
                    className={`${styles.markerWrap} ${isSel ? styles.markerSelected : ''} ${isHov ? styles.markerHovered : ''}`}
                    style={{ left: `${node.xPct}%`, top: `${node.yPct}%` }}
                    onClick={() => setSelected(node)}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    title={node.name}
                  >
                    {/* Pulse ring — selected state */}
                    {isSel && <span className={styles.pulseRing} />}
                    {/* Hover ring */}
                    {isHov && !isSel && <span className={styles.hoverRing} />}
                    {/* Marker dot */}
                    <span className={styles.markerDot} />
                    {/* City label */}
                    <span className={`${styles.markerLabel} ${node.labelDir === 'left' ? styles.labelLeft : styles.labelRight}`}>
                      {node.city}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Info Panel ───────────────────────────────── */}
          <div className={styles.infoPanel}>
            {selected ? (
              <div className={styles.selectedInfo}>

                {/* DC Header */}
                <div className={styles.selectedHeader}>
                  <div className={styles.selectedIconWrap}>
                    <Warehouse size={22} style={{ color: '#38BDF8' }} />
                  </div>
                  <div>
                    <h2 className={styles.selectedName}>{selected.name}</h2>
                    <div className={styles.selectedMeta}>
                      <span className="badge badge-info">{selected.type}</span>
                      <span className="badge badge-default">{selected.region} India</span>
                    </div>
                  </div>
                </div>

                <div className={styles.divider} />

                {/* Executive KPIs */}
                <div className={styles.kpiSection}>
                  <p className={styles.kpiSectionLabel}>Network KPIs</p>

                  {/* Capacity Utilization — with progress bar */}
                  <div className={styles.kpiUtilCard}>
                    <div className={styles.kpiUtilHeader}>
                      <div className={styles.kpiUtilLeft}>
                        <TrendingUp size={13} style={{ color: utilizationColor(selected.kpis.utilization) }} />
                        <span className={styles.kpiUtilLabel}>Capacity Utilization</span>
                      </div>
                      <span
                        className={styles.kpiUtilValue}
                        style={{ color: utilizationColor(selected.kpis.utilization) }}
                      >
                        {selected.kpis.utilization}%
                      </span>
                    </div>
                    <div className={styles.utilBarTrack}>
                      <div
                        className={styles.utilBarFill}
                        style={{
                          width: `${selected.kpis.utilization}%`,
                          background: utilizationColor(selected.kpis.utilization),
                        }}
                      />
                    </div>
                  </div>

                  {/* Other KPI rows */}
                  <div className={styles.kpiGrid}>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiIconWrap}>
                        <Package size={13} />
                      </div>
                      <div>
                        <div className={styles.kpiValue}>{selected.kpis.activeSKUs.toLocaleString()}</div>
                        <div className={styles.kpiLabel}>Active SKUs</div>
                      </div>
                    </div>

                    <div className={styles.kpiCard}>
                      <div className={styles.kpiIconWrap}>
                        <CheckCircle size={13} />
                      </div>
                      <div>
                        <div className={styles.kpiValue}>{selected.kpis.serviceLevel}%</div>
                        <div className={styles.kpiLabel}>Service Level</div>
                      </div>
                    </div>

                    <div className={styles.kpiCard} style={{ gridColumn: '1 / -1' }}>
                      <div className={styles.kpiIconWrap}>
                        <Truck size={13} />
                      </div>
                      <div>
                        <div className={styles.kpiValue}>{selected.kpis.otif}%</div>
                        <div className={styles.kpiLabel}>Delivery Performance (OTIF)</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Continue CTA */}
                <button
                  className={styles.continueBtn}
                  onClick={handleContinue}
                  disabled={!selected}
                >
                  Proceed to Login
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              /* Empty state */
              <div className={styles.emptyInfo}>
                <div className={styles.emptyIconWrap}>
                  <Warehouse size={28} />
                </div>
                <h3 className={styles.emptyTitle}>No Node Selected</h3>
                <p className={styles.emptyDesc}>
                  Select a Distribution Center on the map to view its network KPIs and set it as your working node.
                </p>

                <div className={styles.quickList}>
                  <p className={styles.quickListLabel}>Available Nodes</p>
                  {NODES.map(n => (
                    <button
                      key={n.id}
                      className={styles.quickItem}
                      onClick={() => setSelected(n)}
                    >
                      <span className={styles.quickDot} />
                      <span className={styles.quickCity}>{n.city}</span>
                      <span className={styles.quickUtil}>{n.kpis.utilization}% util.</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
