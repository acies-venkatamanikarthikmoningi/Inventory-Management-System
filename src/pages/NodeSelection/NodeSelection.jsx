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
    id: 'NOIDA-PLANT',
    name: 'Noida Manufacturing Plant',
    city: 'Noida (NCR)',
    type: 'Manufacturing Plant',
    region: 'North',
    xPct: 31.5,
    yPct: 31.0,
    labelDir: 'right',
    kpis: {
      utilization: 91,
      activeSKUs: 5800,
      serviceLevel: 99.4,
      otif: 98.2,
      leadTime: 'Source',
    },
  },
  {
    id: 'MUM-DC',
    name: 'Mumbai Distribution Center',
    city: 'Mumbai',
    type: 'Distribution Center',
    region: 'West',
    xPct: 16.8,
    yPct: 60.2,
    labelDir: 'left',
    kpis: {
      utilization: 82,
      activeSKUs: 2210,
      serviceLevel: 98.1,
      otif: 95.6,
      leadTime: '2.5 Days',
    },
  },
  {
    id: 'PUNE-DC',
    name: 'Pune Distribution Center',
    city: 'Pune',
    type: 'Distribution Center',
    region: 'West',
    xPct: 20.4,
    yPct: 61.8,
    labelDir: 'right',
    kpis: {
      utilization: 67,
      activeSKUs: 1320,
      serviceLevel: 97.8,
      otif: 96.2,
      leadTime: '2.8 Days',
    },
  },
  {
    id: 'HYD-DC',
    name: 'Hyderabad Distribution Center',
    city: 'Hyderabad',
    type: 'Distribution Center',
    region: 'South',
    xPct: 35.8,
    yPct: 63.7,
    labelDir: 'right',
    kpis: {
      utilization: 63,
      activeSKUs: 986,
      serviceLevel: 96.5,
      otif: 94.9,
      leadTime: '3.2 Days',
    },
  },
  {
    id: 'BANG-DC',
    name: 'Bangalore Distribution Center',
    city: 'Bengaluru',
    type: 'Distribution Center',
    region: 'South',
    xPct: 32.6,
    yPct: 72.2,
    labelDir: 'left',
    kpis: {
      utilization: 70,
      activeSKUs: 1540,
      serviceLevel: 98.6,
      otif: 97.1,
      leadTime: '4.1 Days',
    },
  },
  {
    id: 'CHEN-DC',
    name: 'Chennai Distribution Center',
    city: 'Chennai',
    type: 'Distribution Center',
    region: 'South',
    xPct: 43.5,
    yPct: 72.5,
    labelDir: 'right',
    kpis: {
      utilization: 77,
      activeSKUs: 1842,
      serviceLevel: 98.4,
      otif: 96.8,
      leadTime: '4.5 Days',
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
                <span className={styles.mapDot} /> DC Node &nbsp;·&nbsp; <span className={styles.plantDot} /> Mfg Plant
              </span>
              <span className={styles.mapLegendHint}>Hover to inspect route/lead time</span>
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

              {/* Route lines connecting Noida Plant to all DCs */}
              <svg className={styles.routesOverlay}>
                {NODES.filter(n => n.type === 'Distribution Center').map(dc => {
                  const isRouteHovered = hovered === dc.id || selected?.id === dc.id || hovered === 'NOIDA-PLANT'
                  return (
                    <g key={`route-${dc.id}`}>
                      <line
                        x1="31.5%"
                        y1="31.0%"
                        x2={`${dc.xPct}%`}
                        y2={`${dc.yPct}%`}
                        className={`${styles.routeLine} ${isRouteHovered ? styles.routeHighlight : ''}`}
                      />
                      <line
                        x1="31.5%"
                        y1="31.0%"
                        x2={`${dc.xPct}%`}
                        y2={`${dc.yPct}%`}
                        className={`${styles.routeDash} ${isRouteHovered ? styles.dashHighlight : ''}`}
                      />
                    </g>
                  )
                })}
              </svg>

              {/* Marker overlay — uses percentage positioning relative to the container */}
              {NODES.map(node => {
                const isSel = selected?.id === node.id
                const isHov = hovered === node.id
                const isPlant = node.type === 'Manufacturing Plant'

                return (
                  <div
                    key={node.id}
                    className={`${styles.markerWrap} ${isSel ? styles.markerSelected : ''} ${isHov ? styles.markerHovered : ''} ${isPlant ? styles.plantMarker : ''}`}
                    style={{ left: `${node.xPct}%`, top: `${node.yPct}%` }}
                    onClick={() => {
                      if (!isPlant) {
                        setSelected(node)
                      }
                    }}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    title={node.name}
                  >
                    {isPlant ? (
                      <div className={styles.plantIconWrap}>🏭</div>
                    ) : (
                      <>
                        {/* Pulse ring — selected state */}
                        {isSel && <span className={styles.pulseRing} />}
                        {/* Hover ring */}
                        {isHov && !isSel && <span className={styles.hoverRing} />}
                        {/* Marker dot */}
                        <span className={styles.markerDot} />
                      </>
                    )}
                    {/* City label */}
                    <span className={`${styles.markerLabel} ${node.labelDir === 'left' ? styles.labelLeft : styles.labelRight}`}>
                      {node.city} {isPlant ? '(Plant)' : ''}
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

                {/* Lead Time Info */}
                <div className={styles.leadTimeCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className={styles.plantMiniIcon}>🏭</div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 9, color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Inbound Source</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>Noida Manufacturing Plant</span>
                    </div>
                  </div>
                  <div className={styles.divider} style={{ margin: '8px 0', opacity: 0.3 }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.65)', fontWeight: 500 }}>TRANSIT LEAD TIME</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#38BDF8' }}>{selected.kpis.leadTime}</span>
                  </div>
                </div>

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
                  {NODES.filter(n => n.type === 'Distribution Center').map(n => (
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
