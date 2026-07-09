import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { ArrowRight, ArrowLeft, Warehouse, TrendingUp, Factory, Shuffle, Info } from 'lucide-react'
import styles from './NodeSelection.module.css'

/* ─────────────────────────────────────────────────────────
   NODE DATA — Noida, Delhi, Vijayawada plants
   and Mumbai, Pune, Hyderabad, Bangalore, Chennai, Coimbatore DCs
   xPct/yPct are percentages of the map container width/height
   ─────────────────────────────────────────────────────── */
const NODES = [
  // --- Manufacturing Plants ---
  {
    id: 'NOIDA-PLANT',
    name: 'Noida Manufacturing Plant',
    city: 'Noida',
    type: 'Manufacturing Plant',
    region: 'North',
    xPct: 33.5,
    yPct: 31.5,
    labelDir: 'right',
    kpis: {
      capacity: '500k units/mo',
      productionLines: 8,
      status: 'Active',
      serviceLevel: 99.4,
    }
  },
  {
    id: 'DELHI-PLANT',
    name: 'Delhi Manufacturing Plant',
    city: 'Delhi',
    type: 'Manufacturing Plant',
    region: 'North',
    xPct: 27.5,
    yPct: 28.5,
    labelDir: 'left',
    kpis: {
      capacity: '400k units/mo',
      productionLines: 6,
      status: 'Active',
      serviceLevel: 98.9,
    }
  },
  {
    id: 'VIJAY-PLANT',
    name: 'Vijayawada Manufacturing Plant',
    city: 'Vijayawada',
    type: 'Manufacturing Plant',
    region: 'South',
    xPct: 41.0,
    yPct: 66.5,
    labelDir: 'right',
    kpis: {
      capacity: '600k units/mo',
      productionLines: 10,
      status: 'Active',
      serviceLevel: 99.6,
    }
  },
  // --- Distribution Centers ---
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
    }
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
    }
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
    }
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
    }
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
    }
  },
  {
    id: 'COIMB-DC',
    name: 'Coimbatore Distribution Center',
    city: 'Coimbatore',
    type: 'Distribution Center',
    region: 'South',
    xPct: 34.0,
    yPct: 76.5,
    labelDir: 'right',
    kpis: {
      utilization: 60,
      activeSKUs: 1100,
      serviceLevel: 97.2,
      otif: 95.8,
    }
  }
]

/* ── Mapped route datasets for Plant-to-DCs and DC-to-DC transfers ── */
const PLANT_TO_DC_LEAD_TIMES = {
  'NOIDA-PLANT': {
    'CHEN-DC': '4.5 days',
    'HYD-DC': '3.0 days',
    'PUNE-DC': '4.0 days',
    'COIMB-DC': '5.0 days',
    'BANG-DC': '4.8 days',
    'MUM-DC': '3.8 days',
  },
  'DELHI-PLANT': {
    'CHEN-DC': '4.2 days',
    'HYD-DC': '2.8 days',
    'PUNE-DC': '3.6 days',
    'COIMB-DC': '4.9 days',
    'BANG-DC': '4.6 days',
    'MUM-DC': '3.4 days',
  },
  'VIJAY-PLANT': {
    'CHEN-DC': '1.5 days',
    'HYD-DC': '1.0 day',
    'PUNE-DC': '2.8 days',
    'COIMB-DC': '2.5 days',
    'BANG-DC': '1.9 days',
    'MUM-DC': '3.2 days',
  }
}

const getDCtoDCTransferLeadTime = (fromDC, toDC) => {
  const key = `${fromDC.id}-${toDC.id}`
  const presetTimes = {
    'CHEN-DC-HYD-DC': '1.0 day',
    'CHEN-DC-BANG-DC': '0.8 day',
    'CHEN-DC-PUNE-DC': '1.7 days',
    'HYD-DC-MUM-DC': '1.4 days',
    'BANG-DC-COIMB-DC': '0.6 day',
    'PUNE-DC-MUM-DC': '0.5 day',
    'PUNE-DC-HYD-DC': '1.5 days',
    // reverse/alternate examples
    'HYD-DC-CHEN-DC': '1.0 day',
    'BANG-DC-CHEN-DC': '0.8 day',
    'PUNE-DC-CHEN-DC': '1.7 days',
    'MUM-DC-HYD-DC': '1.4 days',
    'COIMB-DC-BANG-DC': '0.6 day',
    'MUM-DC-PUNE-DC': '0.5 day',
    'HYD-DC-PUNE-DC': '1.5 days',
  }

  if (presetTimes[key]) return presetTimes[key]

  // Dynamic distance computation
  const dx = fromDC.xPct - toDC.xPct
  const dy = fromDC.yPct - toDC.yPct
  const dist = Math.sqrt(dx * dx + dy * dy)

  const computedDays = Math.max(0.4, Math.round((dist * 0.07) * 10) / 10)
  return `${computedDays.toFixed(1)} days`
}

export default function NodeSelection() {
  const { user, setNode } = useApp()
  const navigate = useNavigate()

  const [selected, setSelected] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [mode, setMode] = useState('all-nodes') // 'all-nodes' | 'plant-lead-times' | 'inter-dc-transfers'

  const handleContinue = () => {
    if (!selected || selected.type !== 'Distribution Center') return
    setNode(selected.name)
    if (user) {
      navigate('/app/inventory')
    } else {
      navigate('/login')
    }
  }

  const utilizationColor = (pct) => {
    if (pct > 80) return '#EF4444'
    if (pct > 65) return '#F59E0B'
    return '#22C55E'
  }

  // Handle marker clicks with dynamic mode adjustments
  const handleNodeClick = (node) => {
    if (mode === 'all-nodes') {
      if (node.type === 'Manufacturing Plant') {
        setMode('plant-lead-times')
        setSelected(node)
      } else {
        setSelected(node)
      }
    } else if (mode === 'plant-lead-times') {
      if (node.type === 'Manufacturing Plant') {
        setSelected(node)
      } else {
        // Clicking a DC in plant exploration resets to all-nodes and selects it for login
        setMode('all-nodes')
        setSelected(node)
      }
    } else if (mode === 'inter-dc-transfers') {
      if (node.type === 'Distribution Center') {
        setSelected(node)
      } else {
        // Clicking a plant switches to plant lead times exploration
        setMode('plant-lead-times')
        setSelected(node)
      }
    }
  }

  // Generate dynamic routing lines to draw based on current mode
  const activeRoutes = useMemo(() => {
    if (mode === 'all-nodes' || !selected) return []

    const routes = []

    if (mode === 'plant-lead-times' && selected.type === 'Manufacturing Plant') {
      const plantId = selected.id
      const dcMap = PLANT_TO_DC_LEAD_TIMES[plantId] || {}

      NODES.filter(n => n.type === 'Distribution Center').forEach(dc => {
        if (dcMap[dc.id]) {
          routes.push({
            id: `${plantId}-${dc.id}`,
            from: plantId,
            to: dc.id,
            type: 'plant-to-dc',
            leadTime: dcMap[dc.id]
          })
        }
      })
    } else if (mode === 'inter-dc-transfers' && selected.type === 'Distribution Center') {
      const sourceDC = selected
      NODES.filter(n => n.type === 'Distribution Center' && n.id !== sourceDC.id).forEach(targetDC => {
        const leadTime = getDCtoDCTransferLeadTime(sourceDC, targetDC)
        routes.push({
          id: `${sourceDC.id}-${targetDC.id}`,
          from: sourceDC.id,
          to: targetDC.id,
          type: 'dc-to-dc',
          leadTime: leadTime
        })
      })
    }

    return routes
  }, [mode, selected])

  const badgePositions = useMemo(() => {
    // Group routes by source node so we can stagger routes that share
    // an origin (this is what causes the visual clustering)
    const bySource = {}
    activeRoutes.forEach(route => {
      if (!bySource[route.from]) bySource[route.from] = []
      bySource[route.from].push(route)
    })

    const positions = {}
    // t-values to cycle through so badges land at different points along
    // their line instead of all sitting at the 50% midpoint
    const T_VALUES = [0.38, 0.5, 0.62, 0.44, 0.56, 0.32, 0.68]

    Object.values(bySource).forEach(routesFromSameSource => {
      routesFromSameSource.forEach((route, idx) => {
        const sourceNode = NODES.find(n => n.id === route.from)
        const targetNode = NODES.find(n => n.id === route.to)
        if (!sourceNode || !targetNode) return

        const t = T_VALUES[idx % T_VALUES.length]
        let x = sourceNode.xPct + (targetNode.xPct - sourceNode.xPct) * t
        let y = sourceNode.yPct + (targetNode.yPct - sourceNode.yPct) * t

        // Perpendicular offset so badges fan out sideways from their line,
        // alternating sides based on index, scaled up for later indices
        const dx = targetNode.xPct - sourceNode.xPct
        const dy = targetNode.yPct - sourceNode.yPct
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const perpX = -dy / len
        const perpY = dx / len
        const side = idx % 2 === 0 ? 1 : -1
        const magnitude = Math.floor(idx / 2) * 2.2 // percent units, grows per pair
        x += perpX * side * magnitude
        y += perpY * side * magnitude

        positions[route.id] = { x, y }
      })
    })

    // Basic collision-avoidance pass: nudge any two badges that end up
    // within 3.5% of each other further apart along their own perpendicular
    const ids = Object.keys(positions)
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = positions[ids[i]]
          const b = positions[ids[j]]
          const ddx = a.x - b.x
          const ddy = a.y - b.y
          const dist = Math.sqrt(ddx * ddx + ddy * ddy)
          if (dist < 3.5 && dist > 0) {
            const push = (3.5 - dist) / 2
            const nx = ddx / dist
            const ny = ddy / dist
            a.x += nx * push
            a.y += ny * push
            b.x -= nx * push
            b.y -= ny * push
          }
        }
      }
    }

    return positions
  }, [activeRoutes])

  const activeId = hovered || selected?.id

  // Determine if a specific route is hovered/active
  const isRouteActive = (route) => {
    if (!hovered) return true // Show all routes in current mode if not hovering
    return route.from === hovered || route.to === hovered
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
            <h1 className={styles.title}>Supply Chain Network Map</h1>
            <p className={styles.subtitle}>
              Toggle views to explore manufacturing lead times or inter-unit transfers
            </p>
          </div>
        </div>

        {/* Mode switcher tabs */}
        <div className={styles.tabContainer}>
          <button
            className={`${styles.tabBtn} ${mode === 'all-nodes' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              setMode('all-nodes')
              setSelected(null)
            }}
          >
            <Warehouse size={13} /> Select Working DC
          </button>
          <button
            className={`${styles.tabBtn} ${mode === 'plant-lead-times' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              setMode('plant-lead-times')
              setSelected(NODES.find(n => n.id === 'NOIDA-PLANT'))
            }}
          >
            <Factory size={13} /> Plant Lead Times (All DCs)
          </button>
          <button
            className={`${styles.tabBtn} ${mode === 'inter-dc-transfers' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              setMode('inter-dc-transfers')
              setSelected(NODES.find(n => n.id === 'CHEN-DC'))
            }}
          >
            <Shuffle size={13} /> Inter-DC Transfers
          </button>
        </div>

        <div className={styles.mapLayout}>

          {/* ── India Map ─────────────────────────────────── */}
          <div className={styles.mapWrap}>
            <div className={styles.mapLegendRow}>
              <div className={styles.legendWrapper}>
                <span className={styles.legendLabel}>
                  <div className={styles.plantLegendIcon}>
                    <Factory size={9} style={{ color: '#fff' }} />
                  </div>
                  Mfg Plant &nbsp;·&nbsp;
                  <span className={styles.dcDotLegend} /> DC Node
                  {mode === 'plant-lead-times' && <>&nbsp;·&nbsp;<span className={styles.routeLineLegend} /> Plant to DC Route</>}
                  {mode === 'inter-dc-transfers' && <>&nbsp;·&nbsp;<span className={styles.transferLineLegend} /> DC to DC Transfer</>}
                </span>
              </div>
              <span className={styles.mapLegendHint}>
                {mode === 'all-nodes' && 'Select a DC marker below to proceed with login'}
                {mode === 'plant-lead-times' && 'Click a plant to explore lead times to all DCs'}
                {mode === 'inter-dc-transfers' && 'Click a DC to explore outward transfer paths'}
              </span>
            </div>

            {/* Map container */}
            <div className={styles.mapContainer}>
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/b/b4/India_outline.svg"
                alt="India outline map"
                className={styles.indiaMapImg}
                draggable={false}
              />

              {/* Route lines overlay */}
              {activeRoutes.length > 0 && (
                <svg className={styles.routesOverlay}>
                  {activeRoutes.map(route => {
                    const sourceNode = NODES.find(n => n.id === route.from)
                    const targetNode = NODES.find(n => n.id === route.to)
                    if (!sourceNode || !targetNode) return null

                    const isHigh = isRouteActive(route)
                    const isAnyHovered = !!hovered

                    return (
                      <g key={`route-${route.id}`}>
                        <line
                          x1={`${sourceNode.xPct}%`}
                          y1={`${sourceNode.yPct}%`}
                          x2={`${targetNode.xPct}%`}
                          y2={`${targetNode.yPct}%`}
                          className={`${route.type === 'plant-to-dc' ? styles.routeLine : styles.transferLine} ${isHigh ? styles.routeHighlight : ''}`}
                          style={{
                            opacity: isAnyHovered ? (isHigh ? 0.95 : 0.08) : 0.65
                          }}
                        />
                        <line
                          x1={`${sourceNode.xPct}%`}
                          y1={`${sourceNode.yPct}%`}
                          x2={`${targetNode.xPct}%`}
                          y2={`${targetNode.yPct}%`}
                          className={`${route.type === 'plant-to-dc' ? styles.routeDash : styles.transferDash} ${isHigh ? styles.dashHighlight : ''}`}
                          style={{
                            opacity: isAnyHovered ? (isHigh ? 0.95 : 0) : 0.4
                          }}
                        />
                      </g>
                    )
                  })}
                </svg>
              )}

              {/* Midpoint Lead Time Labels */}
              {activeRoutes.length > 0 && activeRoutes.map(route => {
                const sourceNode = NODES.find(n => n.id === route.from)
                const targetNode = NODES.find(n => n.id === route.to)
                if (!sourceNode || !targetNode) return null

                const pos = badgePositions[route.id]
                if (!pos) return null

                const isHigh = isRouteActive(route)
                const isAnyHovered = !!hovered

                return (
                  <div
                    key={`label-${route.id}`}
                    className={`${styles.routeBadge} ${route.type === 'dc-to-dc' ? styles.badgeTransfer : styles.badgeSource} ${isHigh ? styles.routeBadgeActive : ''}`}
                    style={{
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      opacity: isAnyHovered ? (isHigh ? 1 : 0.1) : 0.85,
                    }}
                  >
                    {route.leadTime}
                  </div>
                )
              })}

              {/* Node Markers */}
              {NODES.map(node => {
                const isSel = selected?.id === node.id
                const isHov = hovered === node.id
                const isPlant = node.type === 'Manufacturing Plant'

                // Visually emphasize plants in plant mode, and DCs in DC mode
                const dimMarker =
                  (mode === 'plant-lead-times' && !isPlant && !isSel) ||
                  (mode === 'inter-dc-transfers' && isPlant)

                return (
                  <div
                    key={node.id}
                    className={`${styles.markerWrap} ${isSel ? styles.markerSelected : ''} ${isHov ? styles.markerHovered : ''} ${isPlant ? styles.plantMarker : ''}`}
                    style={{
                      left: `${node.xPct}%`,
                      top: `${node.yPct}%`,
                      opacity: dimMarker ? 0.45 : 1,
                      transform: isHov ? 'scale(1.08)' : 'scale(1)'
                    }}
                    onClick={() => handleNodeClick(node)}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    title={node.name}
                  >
                    {isPlant ? (
                      <div className={styles.plantIconWrap} style={{ background: isSel ? '#4F46E5' : '#312E81' }}>
                        <Factory size={12} style={{ color: '#fff' }} />
                      </div>
                    ) : (
                      <>
                        {isSel && mode === 'all-nodes' && <span className={styles.pulseRing} />}
                        {isHov && !isSel && <span className={styles.hoverRing} />}
                        <span className={styles.markerDot} style={{ background: isSel ? '#38BDF8' : '#2563EB' }} />
                      </>
                    )}
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

                {/* Header */}
                <div className={styles.selectedHeader}>
                  <div className={styles.selectedIconWrap} style={{ background: selected.type === 'Manufacturing Plant' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(56, 189, 248, 0.15)' }}>
                    {selected.type === 'Manufacturing Plant' ? (
                      <Factory size={22} style={{ color: '#818CF8' }} />
                    ) : (
                      <Warehouse size={22} style={{ color: '#38BDF8' }} />
                    )}
                  </div>
                  <div>
                    <h2 className={styles.selectedName}>{selected.name}</h2>
                    <div className={styles.selectedMeta}>
                      <span className={`badge ${selected.type === 'Manufacturing Plant' ? 'badge-primary' : 'badge-info'}`}>{selected.type}</span>
                      <span className="badge badge-default">{selected.region} India</span>
                    </div>
                  </div>
                </div>

                <div className={styles.divider} />

                {/* 1. Plant Lead Times Exploration View */}
                {mode === 'plant-lead-times' && selected.type === 'Manufacturing Plant' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className={styles.kpiSection}>
                      <p className={styles.kpiSectionLabel}>Plant Metrics</p>
                      <div className={styles.kpiGrid}>
                        <div className={styles.kpiCard}>
                          <div className={styles.kpiValue} style={{ color: '#818CF8' }}>{selected.kpis.capacity}</div>
                          <div className={styles.kpiLabel}>Prod. Capacity</div>
                        </div>
                        <div className={styles.kpiCard}>
                          <div className={styles.kpiValue}>{selected.kpis.productionLines}</div>
                          <div className={styles.kpiLabel}>Prod. Lines</div>
                        </div>
                        <div className={styles.kpiCard} style={{ gridColumn: '1 / -1' }}>
                          <div className={styles.kpiValue}>{selected.kpis.serviceLevel}% SLA Adherence</div>
                          <div className={styles.kpiLabel}>Quality & Logistics Score</div>
                        </div>
                      </div>
                    </div>

                    <div className={styles.routeSection}>
                      <p className={styles.kpiSectionLabel}>Inbound Lead Times to all DCs</p>
                      <div className={styles.connectionsList}>
                        {NODES.filter(n => n.type === 'Distribution Center').map(dc => {
                          const leadTime = PLANT_TO_DC_LEAD_TIMES[selected.id]?.[dc.id] || 'N/A'
                          return (
                            <div
                              key={dc.id}
                              className={styles.connectionItem}
                              onMouseEnter={() => setHovered(dc.id)}
                              onMouseLeave={() => setHovered(null)}
                              onClick={() => {
                                setMode('all-nodes')
                                setSelected(dc)
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Warehouse size={13} style={{ color: '#38BDF8' }} />
                                <span style={{ fontSize: 12, fontWeight: 500, color: '#fff' }}>{dc.name}</span>
                              </div>
                              <span className={styles.leadTimeLabel}>{leadTime}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Inter-DC Transfer Exploration View */}
                {mode === 'inter-dc-transfers' && selected.type === 'Distribution Center' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className={styles.kpiSection}>
                      <p className={styles.kpiSectionLabel}>Source DC Details</p>
                      <div className={styles.kpiGrid}>
                        <div className={styles.kpiCard}>
                          <div className={styles.kpiValue}>{selected.kpis.utilization}%</div>
                          <div className={styles.kpiLabel}>Capacity Util.</div>
                        </div>
                        <div className={styles.kpiCard}>
                          <div className={styles.kpiValue}>{selected.kpis.activeSKUs}</div>
                          <div className={styles.kpiLabel}>Active SKUs</div>
                        </div>
                      </div>
                    </div>

                    <div className={styles.routeSection}>
                      <p className={styles.kpiSectionLabel}>Transfer Lead Times to all other DCs</p>
                      <div className={styles.connectionsList}>
                        {NODES.filter(n => n.type === 'Distribution Center' && n.id !== selected.id).map(destDC => {
                          const leadTime = getDCtoDCTransferLeadTime(selected, destDC)
                          return (
                            <div
                              key={destDC.id}
                              className={styles.connectionItem}
                              onMouseEnter={() => setHovered(destDC.id)}
                              onMouseLeave={() => setHovered(null)}
                              onClick={() => setSelected(destDC)}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Shuffle size={13} style={{ color: '#F59E0B' }} />
                                <span style={{ fontSize: 12, fontWeight: 500, color: '#fff' }}>To {destDC.city} DC</span>
                              </div>
                              <span className={styles.leadTimeLabel} style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#F59E0B', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                                {leadTime}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. All Nodes DC Login Selection View */}
                {mode === 'all-nodes' && selected.type === 'Distribution Center' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className={styles.kpiSection}>
                      <p className={styles.kpiSectionLabel}>DC Metrics</p>

                      <div className={styles.kpiUtilCard}>
                        <div className={styles.kpiUtilHeader}>
                          <div className={styles.kpiUtilLeft}>
                            <TrendingUp size={13} style={{ color: utilizationColor(selected.kpis.utilization) }} />
                            <span className={styles.kpiUtilLabel}>Capacity Utilization</span>
                          </div>
                          <span className={styles.kpiUtilValue} style={{ color: utilizationColor(selected.kpis.utilization) }}>
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

                      <div className={styles.kpiGrid} style={{ marginTop: 10 }}>
                        <div className={styles.kpiCard}>
                          <div className={styles.kpiValue}>{selected.kpis.activeSKUs.toLocaleString()}</div>
                          <div className={styles.kpiLabel}>Active SKUs</div>
                        </div>
                        <div className={styles.kpiCard}>
                          <div className={styles.kpiValue}>{selected.kpis.serviceLevel}%</div>
                          <div className={styles.kpiLabel}>Service Level</div>
                        </div>
                      </div>
                    </div>

                    <div className={styles.continueSection}>
                      <button
                        className={styles.continueBtn}
                        onClick={handleContinue}
                      >
                        Proceed with {selected.city} DC
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Footer status warning if wrong node type selected for current mode */}
                {mode === 'plant-lead-times' && selected.type === 'Distribution Center' && (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <p style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.4)' }}>
                      Selected <strong>{selected.city} DC</strong>. Switch to Plant exploration or click a plant marker to view plant lead times.
                    </p>
                    <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setMode('all-nodes')}>
                      Switch to DC Selection
                    </button>
                  </div>
                )}
                {mode === 'inter-dc-transfers' && selected.type === 'Manufacturing Plant' && (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <p style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.4)' }}>
                      Selected <strong>{selected.city} Plant</strong>. Click a DC node marker to view its outbound transfer paths.
                    </p>
                    <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setMode('plant-lead-times')}>
                      Switch to Plant Lead Times
                    </button>
                  </div>
                )}

              </div>
            ) : (
              /* Empty state (Nothing selected) */
              <div className={styles.emptyInfo}>
                <div className={styles.emptyIconWrap}>
                  <Info size={24} style={{ color: 'var(--color-primary-light)' }} />
                </div>
                <h3 className={styles.emptyTitle}>
                  {mode === 'all-nodes' && 'Select Working DC'}
                  {mode === 'plant-lead-times' && 'Select Plant'}
                  {mode === 'inter-dc-transfers' && 'Select Source DC'}
                </h3>
                <p className={styles.emptyDesc}>
                  {mode === 'all-nodes' && 'Click a Distribution Center on the map to set it as your working node and proceed to login.'}
                  {mode === 'plant-lead-times' && 'Click any of the 3 Manufacturing Plants (Delhi, Noida, Vijayawada) to display lead times to all DCs.'}
                  {mode === 'inter-dc-transfers' && 'Click any DC marker on the map to view transfer lead times to other connected DCs.'}
                </p>

                <div className={styles.quickList} style={{ marginTop: 12 }}>
                  <p className={styles.quickListLabel}>
                    {mode === 'plant-lead-times' ? 'Manufacturing Plants' : 'Distribution Centers'}
                  </p>
                  {mode === 'plant-lead-times' ? (
                    NODES.filter(n => n.type === 'Manufacturing Plant').map(n => (
                      <button
                        key={n.id}
                        className={styles.quickItem}
                        onClick={() => setSelected(n)}
                        style={{ borderLeft: '3px solid #818CF8' }}
                      >
                        <span className={styles.plantDotLegend} />
                        <span className={styles.quickCity}>{n.name}</span>
                        <span className={styles.quickUtil}>{n.kpis.capacity}</span>
                      </button>
                    ))
                  ) : (
                    NODES.filter(n => n.type === 'Distribution Center').map(n => (
                      <button
                        key={n.id}
                        className={styles.quickItem}
                        onClick={() => setSelected(n)}
                      >
                        <span className={styles.quickDot} />
                        <span className={styles.quickCity}>{n.city} DC</span>
                        <span className={styles.quickUtil}>{n.kpis.utilization}% util.</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
