import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import {
  ChevronRight, Warehouse, LayoutGrid, Layers, Archive, Package, Tag, Activity, MapPin
} from 'lucide-react'
import inventoryData from '../../data/inventory.json'
import Drawer, { DrawerSection, DetailGrid, MovementHistory } from '../../components/Drawer/Drawer'
import styles from './LocationHierarchy.module.css'

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

const today = new Date()
const daysUntil = d => Math.ceil((new Date(d) - today) / 86400000)

const classificationClass = c => ({
  'Fast Moving':   'badge-success',
  'Medium Moving': 'badge-warning',
  'Slow Moving':   'badge-info',
}[c] || 'badge-default')

const NODE_KPIS = {
  'Chennai Distribution Center': { utilization: 77, activeSKUs: 1842, serviceLevel: 98.4, otif: 96.8, address: 'Plot 42, SIPCOT Industrial Estate, Hosur Road, Chennai - 600032' },
  'Bangalore Distribution Center': { utilization: 70, activeSKUs: 1540, serviceLevel: 98.6, otif: 97.1, address: 'Sy No. 78, Electronic City Phase II, Bengaluru - 560100' },
  'Mumbai Distribution Center': { utilization: 82, activeSKUs: 2210, serviceLevel: 98.1, otif: 95.6, address: 'Plot 15, MIDC Andheri East, Mumbai - 400093' },
  'Hyderabad Distribution Center': { utilization: 63, activeSKUs: 986, serviceLevel: 96.5, otif: 94.9, address: 'IDA Jeedimetla, Phase III, Hyderabad - 500055' },
  'Pune Distribution Center': { utilization: 67, activeSKUs: 1320, serviceLevel: 97.8, otif: 96.2, address: 'Gut No. 234, Chakan Industrial Area, Pune - 410501' }
}

export default function LocationHierarchy() {
  const { node } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()

  // Track hierarchy levels
  const [selectedZone, setSelectedZone] = useState(null)
  const [selectedArea, setSelectedArea] = useState(null)
  const [selectedShelf, setSelectedShelf] = useState(null)
  const [selectedBin, setSelectedBin] = useState(null)
  const [selectedSKUCode, setSelectedSKUCode] = useState(null)
  const [selectedBatchItem, setSelectedBatchItem] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const activeNodeName = node || 'Chennai Distribution Center'

  const dbNodeMap = useMemo(() => ({
    'Mumbai Distribution Center': 'Mumbai Distribution Center',
    'Pune Distribution Center': 'Pune Warehouse',
    'Hyderabad Distribution Center': 'Hyderabad Plant',
    'Bangalore Distribution Center': 'Bangalore Distribution Center',
    'Chennai Distribution Center': 'Chennai Distribution Center',
  }), [])

  const targetNode = dbNodeMap[activeNodeName] || activeNodeName

  // Resolve current active Node KPIs
  const currentKPIs = useMemo(() => {
    return NODE_KPIS[activeNodeName] || NODE_KPIS['Chennai Distribution Center']
  }, [activeNodeName])

  // Parse location and group items for the selected Working Node only
  const activeItems = useMemo(() => {
    return inventoryData
      .filter(item => item.node === targetNode)
      .map(item => ({
        ...item,
        ...parseLocation(item.location),
        bucketVal: getBucket(item)
      }))
  }, [targetNode])

  // Sync with searchParams on mount/change
  useEffect(() => {
    const zone = searchParams.get('zone')
    const area = searchParams.get('area')
    const bin = searchParams.get('bin')
    const sku = searchParams.get('sku')
    const batch = searchParams.get('batch')

    // Automatically resolve shelf from bin if missing
    const shelf = searchParams.get('shelf') || (bin ? parseShelf(bin) : null)

    if (zone) setSelectedZone(zone)
    else setSelectedZone(null)

    if (area) setSelectedArea(area)
    else setSelectedArea(null)

    if (shelf) setSelectedShelf(shelf)
    else setSelectedShelf(null)

    if (bin) setSelectedBin(bin)
    else setSelectedBin(null)

    if (sku) setSelectedSKUCode(sku)
    else setSelectedSKUCode(null)

    if (batch && sku && bin) {
      const found = activeItems.find(i => i.skuCode === sku && i.bin === bin && i.batch === batch)
      if (found) {
        setSelectedBatchItem(found)
        setDrawerOpen(true)
      } else {
        setSelectedBatchItem(null)
        setDrawerOpen(false)
      }
    } else {
      setSelectedBatchItem(null)
      setDrawerOpen(false)
    }
  }, [searchParams, activeItems])

  // Drill transitions with loading states
  const drillToZone = (zoneName) => {
    setLoading(true)
    setTimeout(() => {
      setSelectedZone(zoneName)
      setSelectedArea(null)
      setSelectedShelf(null)
      setSelectedBin(null)
      setSelectedSKUCode(null)
      setSelectedBatchItem(null)
      setSearchParams({ zone: zoneName })
      setLoading(false)
    }, 200)
  }

  const drillToArea = (areaName) => {
    setLoading(true)
    setTimeout(() => {
      setSelectedArea(areaName)
      setSelectedShelf(null)
      setSelectedBin(null)
      setSelectedSKUCode(null)
      setSelectedBatchItem(null)
      setSearchParams({ zone: selectedZone, area: areaName })
      setLoading(false)
    }, 200)
  }

  const drillToShelf = (shelfName) => {
    setLoading(true)
    setTimeout(() => {
      setSelectedShelf(shelfName)
      setSelectedBin(null)
      setSelectedSKUCode(null)
      setSelectedBatchItem(null)
      setSearchParams({ zone: selectedZone, area: selectedArea, shelf: shelfName })
      setLoading(false)
    }, 200)
  }

  const drillToBin = (binName) => {
    setLoading(true)
    setTimeout(() => {
      setSelectedBin(binName)
      setSelectedSKUCode(null)
      setSelectedBatchItem(null)
      setSearchParams({ zone: selectedZone, area: selectedArea, shelf: selectedShelf, bin: binName })
      setLoading(false)
    }, 200)
  }

  const drillToSKU = (skuCode) => {
    setLoading(true)
    setTimeout(() => {
      setSelectedSKUCode(skuCode)
      setSelectedBatchItem(null)
      setSearchParams({ zone: selectedZone, area: selectedArea, shelf: selectedShelf, bin: selectedBin, sku: skuCode })
      setLoading(false)
    }, 200)
  }

  const drillToBatch = (item) => {
    setSelectedBatchItem(item)
    setDrawerOpen(true)
    setSearchParams({
      zone: selectedZone,
      area: selectedArea,
      shelf: selectedShelf,
      bin: selectedBin,
      sku: selectedSKUCode,
      batch: item.batch
    })
  }

  const closeBatchDetails = () => {
    setDrawerOpen(false)
    setSearchParams({
      zone: selectedZone,
      area: selectedArea,
      shelf: selectedShelf,
      bin: selectedBin,
      sku: selectedSKUCode
    })
  }

  const resetToLanding = () => {
    setSelectedZone(null)
    setSelectedArea(null)
    setSelectedShelf(null)
    setSelectedBin(null)
    setSelectedSKUCode(null)
    setSelectedBatchItem(null)
    setSearchParams({})
  }

  // --- Dynamic Groupings ---
  
  // 1. Unique Zones list (Landing Level)
  const zonesList = useMemo(() => {
    const zones = [...new Set(activeItems.map(i => i.zone))].sort()
    const staticMetadata = {
      'Zone 1': { type: 'General Storage', util: 72 },
      'Zone 2': { type: 'PPE Storage', util: 81 },
      'Zone 3': { type: 'Medical', util: 65 },
      'Zone 4': { type: 'Cold Storage', util: 55 },
      'Zone 5': { type: 'Nutraceuticals', util: 40 }
    }
    return zones.map(z => {
      const items = activeItems.filter(i => i.zone === z)
      const uniqueSKUs = new Set(items.map(i => i.skuCode)).size
      return {
        name: z,
        storageType: staticMetadata[z]?.type || 'General Storage',
        activeSKUs: uniqueSKUs,
        utilization: staticMetadata[z]?.util || 60
      }
    })
  }, [activeItems])

  // 2. Areas under selected Zone (Zone Level)
  const areasList = useMemo(() => {
    if (!selectedZone) return []
    const items = activeItems.filter(i => i.zone === selectedZone)
    const areas = [...new Set(items.map(i => i.area))].sort()
    return areas.map(a => {
      const subItems = items.filter(i => i.area === a)
      const uniqueSKUs = new Set(subItems.map(i => i.skuCode)).size
      return {
        name: a,
        activeSKUs: uniqueSKUs
      }
    })
  }, [selectedZone, activeItems])

  // 3. Shelves under selected Area (Area Level)
  const shelvesList = useMemo(() => {
    if (!selectedZone || !selectedArea) return []
    const items = activeItems.filter(i => i.zone === selectedZone && i.area === selectedArea)
    const shelves = [...new Set(items.map(i => parseShelf(i.bin)))].sort()
    return shelves.map(sh => {
      const subItems = items.filter(i => parseShelf(i.bin) === sh)
      const uniqueSKUs = new Set(subItems.map(i => i.skuCode)).size
      return {
        name: sh,
        activeSKUs: uniqueSKUs
      }
    })
  }, [selectedZone, selectedArea, activeItems])

  // 4. Bins under selected Shelf (Shelf Level)
  const binsList = useMemo(() => {
    if (!selectedZone || !selectedArea || !selectedShelf) return []
    const items = activeItems.filter(i => i.zone === selectedZone && i.area === selectedArea && parseShelf(i.bin) === selectedShelf)
    const bins = [...new Set(items.map(i => i.bin))].sort()
    return bins.map(b => {
      const subItems = items.filter(i => i.bin === b)
      const uniqueSKUs = new Set(subItems.map(i => i.skuCode)).size
      return {
        name: b,
        activeSKUs: uniqueSKUs
      }
    })
  }, [selectedZone, selectedArea, selectedShelf, activeItems])

  // 5. Unique SKUs inside selected Bin (Bin Level)
  const binSKUsList = useMemo(() => {
    if (!selectedZone || !selectedArea || !selectedShelf || !selectedBin) return []
    const items = activeItems.filter(i => i.zone === selectedZone && i.area === selectedArea && parseShelf(i.bin) === selectedShelf && i.bin === selectedBin)
    const uniqueSKUMap = {}
    items.forEach(item => {
      if (!uniqueSKUMap[item.skuCode]) {
        uniqueSKUMap[item.skuCode] = {
          skuCode: item.skuCode,
          skuName: item.skuName,
          brand: item.brand,
          category: item.category,
          classification: item.classification,
          storageCondition: item.storageCondition,
          availableQty: 0
        }
      }
      uniqueSKUMap[item.skuCode].availableQty += item.availableQty
    })
    return Object.values(uniqueSKUMap)
  }, [selectedZone, selectedArea, selectedShelf, selectedBin, activeItems])

  // 6. Batches for selected SKU (SKU Level)
  const skuBatchesList = useMemo(() => {
    if (!selectedZone || !selectedArea || !selectedShelf || !selectedBin || !selectedSKUCode) return []
    return activeItems.filter(i => i.zone === selectedZone && i.area === selectedArea && parseShelf(i.bin) === selectedShelf && i.bin === selectedBin && i.skuCode === selectedSKUCode)
  }, [selectedZone, selectedArea, selectedShelf, selectedBin, selectedSKUCode, activeItems])

  // Breadcrumbs helper
  const breadcrumbs = useMemo(() => {
    const crumbs = [{ name: activeNodeName, level: 0 }]
    if (selectedZone) crumbs.push({ name: selectedZone, level: 1 })
    if (selectedArea) crumbs.push({ name: selectedArea, level: 2 })
    if (selectedShelf) crumbs.push({ name: selectedShelf, level: 3 })
    if (selectedBin) crumbs.push({ name: selectedBin, level: 4 })
    if (selectedSKUCode) crumbs.push({ name: selectedSKUCode, level: 5 })
    return crumbs
  }, [activeNodeName, selectedZone, selectedArea, selectedShelf, selectedBin, selectedSKUCode])

  const handleBreadcrumbClick = (level) => {
    if (level === 0) resetToLanding()
    else if (level === 1) drillToZone(selectedZone)
    else if (level === 2) drillToArea(selectedArea)
    else if (level === 3) drillToShelf(selectedShelf)
    else if (level === 4) drillToBin(selectedBin)
    else if (level === 5) drillToSKU(selectedSKUCode)
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h2>Location Hierarchy</h2>
          <p>Physical node-level inventory storage configuration</p>
        </div>
      </div>

      {/* Breadcrumb Bar */}
      <div className={styles.breadcrumbBar}>
        {breadcrumbs.map((crumb, idx) => (
          <span key={idx} className={styles.breadcrumbItem}>
            {idx > 0 && <ChevronRight size={14} className={styles.breadcrumbSep} />}
            <button
              className={`${styles.breadcrumbLink} ${idx === breadcrumbs.length - 1 ? styles.activeCrumb : ''}`}
              onClick={() => handleBreadcrumbClick(crumb.level)}
              disabled={idx === breadcrumbs.length - 1}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <p>Retrieving warehouse storage nodes...</p>
        </div>
      ) : (
        <>
          {/* 0. Landing Level (List Zones) */}
          {!selectedZone && (
            <div className={styles.landingContainer}>
              <div className={styles.dcHeaderCard}>
                <div className={styles.dcHeaderIcon}>
                  <Warehouse size={28} />
                </div>
                <div>
                  <h3 className={styles.dcTitle}>{activeNodeName}</h3>
                  <p className={styles.dcSubtitle}>{currentKPIs.address}</p>
                </div>
              </div>

              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Capacity Utilization</span>
                    <span className={styles.kpiValue} style={{ color: 'var(--color-warning)' }}>{currentKPIs.utilization}%</span>
                  </div>
                  <div className="progress-bar-container" style={{ marginTop: 8, height: 6 }}>
                    <div className="progress-bar-fill" style={{ width: `${currentKPIs.utilization}%`, backgroundColor: 'var(--color-warning)' }} />
                  </div>
                  <span className={styles.kpiSubtext}>Pallets occupancy configuration</span>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Active SKUs</span>
                    <span className={styles.kpiValue}>{currentKPIs.activeSKUs.toLocaleString()}</span>
                  </div>
                  <span className={styles.kpiSubtext}>Active material master codes</span>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Service Level</span>
                    <span className={styles.kpiValue} style={{ color: 'var(--color-success)' }}>{currentKPIs.serviceLevel}%</span>
                  </div>
                  <span className={styles.kpiSubtext}>Against service commitments</span>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Delivery Performance (OTIF)</span>
                    <span className={styles.kpiValue} style={{ color: 'var(--color-success)' }}>{currentKPIs.otif}%</span>
                  </div>
                  <span className={styles.kpiSubtext}>On-Time In-Full score</span>
                </div>
              </div>

              <h4 className={styles.sectionTitle}>Physical Storage Zones</h4>
              <div className={styles.zoneGrid}>
                {zonesList.map(zone => (
                  <div key={zone.name} className={`card ${styles.zoneCard}`} onClick={() => drillToZone(zone.name)}>
                    <div className={styles.zoneCardHeader}>
                      <LayoutGrid size={18} className={styles.zoneIcon} />
                      <span className={styles.zoneName}>{zone.name}</span>
                    </div>
                    <div className={styles.zoneCardBody}>
                      <div className={styles.zoneStorageType}>{zone.storageType}</div>
                      <div className={styles.zoneStatsRow}>
                        <span>Active SKUs: <strong>{zone.activeSKUs}</strong></span>
                        <span>Utilization: <strong>{zone.utilization}%</strong></span>
                      </div>
                      <div className="progress-bar-container" style={{ marginTop: 6, height: 4 }}>
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: `${zone.utilization}%`,
                            backgroundColor: zone.utilization > 80 ? 'var(--color-danger)' : 'var(--color-success)'
                          }}
                        />
                      </div>
                    </div>
                    <div className={styles.zoneCardFooter}>
                      <span>View Areas</span>
                      <ChevronRight size={14} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 1. Zone Level (List Areas) */}
          {selectedZone && !selectedArea && (
            <div className={styles.levelContainer}>
              <div className={styles.levelHeaderCard}>
                <div className={styles.levelHeaderIcon} style={{ background: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                  <LayoutGrid size={24} />
                </div>
                <div>
                  <h3 className={styles.levelTitle}>{selectedZone} Overview</h3>
                  <p className={styles.levelSubtitle}>Zone Node Details within {activeNodeName}</p>
                </div>
              </div>

              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Capacity Utilization</span>
                    <span className={styles.kpiValue} style={{ color: 'var(--color-success)' }}>
                      {zonesList.find(z => z.name === selectedZone)?.utilization || 70}%
                    </span>
                  </div>
                  <div className="progress-bar-container" style={{ marginTop: 8, height: 6 }}>
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${zonesList.find(z => z.name === selectedZone)?.utilization || 70}%`,
                        backgroundColor: 'var(--color-success)'
                      }}
                    />
                  </div>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Active SKUs</span>
                    <span className={styles.kpiValue}>
                      {zonesList.find(z => z.name === selectedZone)?.activeSKUs || 0}
                    </span>
                  </div>
                  <span className={styles.kpiSubtext}>Stored in this zone</span>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Inventory Summary</span>
                    <span className={styles.kpiValue}>
                      {activeItems
                        .filter(i => i.zone === selectedZone)
                        .reduce((sum, i) => sum + i.availableQty, 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  <span className={styles.kpiSubtext}>Total Available Qty (Units)</span>
                </div>
              </div>

              <h4 className={styles.sectionTitle}>Areas in {selectedZone}</h4>
              <div className={styles.typeGrid}>
                {areasList.map(area => (
                  <div key={area.name} className={`card ${styles.typeCard}`} onClick={() => drillToArea(area.name)}>
                    <div className={styles.typeCardHeader}>
                      <Layers size={18} className={styles.typeIcon} />
                      <span className={styles.typeName}>{area.name}</span>
                    </div>
                    <div className={styles.typeCardBody}>
                      <span>Active SKUs: <strong>{area.activeSKUs}</strong></span>
                    </div>
                    <div className={styles.typeCardFooter}>
                      <span>View Shelves</span>
                      <ChevronRight size={14} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. Area Level (List Shelves) */}
          {selectedZone && selectedArea && !selectedShelf && (
            <div className={styles.levelContainer}>
              <div className={styles.levelHeaderCard}>
                <div className={styles.levelHeaderIcon} style={{ background: 'var(--color-info-light)', color: 'var(--color-info)' }}>
                  <Layers size={24} />
                </div>
                <div>
                  <h3 className={styles.levelTitle}>{selectedArea} Overview</h3>
                  <p className={styles.levelSubtitle}>Area Node under {selectedZone}</p>
                </div>
              </div>

              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Active SKUs</span>
                    <span className={styles.kpiValue}>
                      {areasList.find(a => a.name === selectedArea)?.activeSKUs || 0}
                    </span>
                  </div>
                  <span className={styles.kpiSubtext}>Stored in this area</span>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Total Inventory Quantity</span>
                    <span className={styles.kpiValue}>
                      {activeItems
                        .filter(i => i.zone === selectedZone && i.area === selectedArea)
                        .reduce((sum, i) => sum + i.availableQty, 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  <span className={styles.kpiSubtext}>Total Available Qty (Units)</span>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Shelves Configured</span>
                    <span className={styles.kpiValue}>{shelvesList.length}</span>
                  </div>
                  <span className={styles.kpiSubtext}>Inventory Shelves inside {selectedArea}</span>
                </div>
              </div>

              <h4 className={styles.sectionTitle}>Shelves in {selectedArea}</h4>
              <div className={styles.typeGrid}>
                {shelvesList.map(shelf => (
                  <div key={shelf.name} className={`card ${styles.typeCard}`} onClick={() => drillToShelf(shelf.name)}>
                    <div className={styles.typeCardHeader}>
                      <Warehouse size={18} className={styles.typeIcon} style={{ color: 'var(--color-primary-light)' }} />
                      <span className={styles.typeName}>{shelf.name}</span>
                    </div>
                    <div className={styles.typeCardBody}>
                      <span>Active SKUs: <strong>{shelf.activeSKUs}</strong></span>
                    </div>
                    <div className={styles.typeCardFooter}>
                      <span>View Bins</span>
                      <ChevronRight size={14} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Shelf Level (List Bins) */}
          {selectedZone && selectedArea && selectedShelf && !selectedBin && (
            <div className={styles.levelContainer}>
              <div className={styles.levelHeaderCard}>
                <div className={styles.levelHeaderIcon} style={{ background: 'var(--color-info-light)', color: 'var(--color-info)' }}>
                  <Warehouse size={24} />
                </div>
                <div>
                  <h3 className={styles.levelTitle}>{selectedShelf} Overview</h3>
                  <p className={styles.levelSubtitle}>Shelf under {selectedArea} ({selectedZone})</p>
                </div>
              </div>

              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Active SKUs</span>
                    <span className={styles.kpiValue}>
                      {shelvesList.find(s => s.name === selectedShelf)?.activeSKUs || 0}
                    </span>
                  </div>
                  <span className={styles.kpiSubtext}>Stored on this shelf</span>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Total Inventory Quantity</span>
                    <span className={styles.kpiValue}>
                      {activeItems
                        .filter(i => i.zone === selectedZone && i.area === selectedArea && parseShelf(i.bin) === selectedShelf)
                        .reduce((sum, i) => sum + i.availableQty, 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  <span className={styles.kpiSubtext}>Total Available Qty (Units)</span>
                </div>

                <div className={styles.kpiCard}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiLabel}>Bins on Shelf</span>
                    <span className={styles.kpiValue}>{binsList.length}</span>
                  </div>
                  <span className={styles.kpiSubtext}>Storage Bins configured</span>
                </div>
              </div>

              <h4 className={styles.sectionTitle}>Bins on {selectedShelf}</h4>
              <div className={styles.binGrid}>
                {binsList.map(bin => (
                  <div key={bin.name} className={`card ${styles.binCard}`} onClick={() => drillToBin(bin.name)}>
                    <div className={styles.binCardHeader}>
                      <Archive size={16} className={styles.binIcon} />
                      <span className={styles.binName}>{bin.name}</span>
                    </div>
                    <div className={styles.binCardBody}>
                      <span>Active SKUs: <strong>{bin.activeSKUs}</strong></span>
                    </div>
                    <div className={styles.binCardFooter}>
                      <span>View SKUs</span>
                      <ChevronRight size={14} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Bin Level (List SKUs) */}
          {selectedZone && selectedArea && selectedShelf && selectedBin && !selectedSKUCode && (
            <div className={styles.levelContainer}>
              <div className={styles.levelHeaderCard}>
                <div className={styles.levelHeaderIcon} style={{ background: 'var(--color-primary-light)', color: '#fff' }}>
                  <Archive size={24} />
                </div>
                <div>
                  <h3 className={styles.levelTitle}>{selectedBin} Details</h3>
                  <p className={styles.levelSubtitle}>Storage Bin on {selectedShelf} ({selectedArea})</p>
                </div>
              </div>

              <div className={styles.kpiGrid} style={{ marginBottom: 20 }}>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Unique SKUs in Bin</span>
                  <span className={styles.kpiValue}>{binSKUsList.length}</span>
                </div>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Total Inventory Qty</span>
                  <span className={styles.kpiValue}>
                    {binSKUsList.reduce((sum, i) => sum + i.availableQty, 0).toLocaleString()}
                  </span>
                </div>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Storage Condition</span>
                  <span className={styles.kpiValue} style={{ fontSize: 15, marginTop: 4 }}>
                    {binSKUsList[0]?.storageCondition || 'Room Temperature'}
                  </span>
                </div>
              </div>

              <h4 className={styles.sectionTitle}>SKUs Stored in {selectedBin}</h4>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-container" style={{ borderRadius: 12, overflowY: 'hidden' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>SKU Code</th>
                        <th>SKU Description</th>
                        <th>Brand</th>
                        <th>Classification</th>
                        <th>Total Available Quantity</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {binSKUsList.map(item => (
                        <tr key={item.skuCode} className={styles.skuRow} onClick={() => drillToSKU(item.skuCode)}>
                          <td><code>{item.skuCode}</code></td>
                          <td>
                            <div className={styles.skuTableTitle}>{item.skuName}</div>
                            <div className="text-xs text-muted">{item.category}</div>
                          </td>
                          <td className="text-sm">{item.brand}</td>
                          <td>
                            <span className={`badge ${classificationClass(item.classification)}`}>
                              {item.classification}
                            </span>
                          </td>
                          <td><strong>{item.availableQty.toLocaleString()}</strong></td>
                          <td>
                            <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); drillToSKU(item.skuCode); }}>
                              View Batches →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 5. SKU Level (List Batches) */}
          {selectedZone && selectedArea && selectedShelf && selectedBin && selectedSKUCode && (
            <div className={styles.levelContainer}>
              <div className={styles.levelHeaderCard}>
                <div className={styles.levelHeaderIcon} style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                  <Package size={24} />
                </div>
                <div>
                  <h3 className={styles.levelTitle}>{selectedSKUCode} Batches</h3>
                  <p className={styles.levelSubtitle}>SKU in {selectedBin} ({selectedShelf} · {selectedArea})</p>
                </div>
              </div>

              <div className={styles.kpiGrid} style={{ marginBottom: 20 }}>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>SKU Description</span>
                  <span className={styles.kpiValue} style={{ fontSize: 15, marginTop: 4 }}>
                    {skuBatchesList[0]?.skuName || ''}
                  </span>
                </div>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Total Batches</span>
                  <span className={styles.kpiValue}>{skuBatchesList.length}</span>
                </div>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Total Available Quantity</span>
                  <span className={styles.kpiValue}>
                    {skuBatchesList.reduce((sum, i) => sum + i.availableQty, 0).toLocaleString()}
                  </span>
                </div>
              </div>

              <h4 className={styles.sectionTitle}>Batches for {selectedSKUCode} in {selectedBin}</h4>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-container" style={{ borderRadius: 12, overflowY: 'hidden' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Batch ID</th>
                        <th>Mfg Date</th>
                        <th>Expiry Date</th>
                        <th>Remaining Days</th>
                        <th>Bucket</th>
                        <th>Available Quantity</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skuBatchesList.map(item => (
                        <tr key={item.id} className={styles.skuRow} onClick={() => drillToBatch(item)}>
                          <td>
                            <code style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--color-surface-hover)', padding: '2px 6px', borderRadius: 4, color: 'var(--color-primary-light)', fontWeight: 600 }}>
                              {item.batch}
                            </code>
                          </td>
                          <td className="text-sm">{item.mfgDate}</td>
                          <td className="text-sm">{item.expiry}</td>
                          <td className="text-sm font-semibold">
                            {(() => {
                              const d = daysUntil(item.expiry)
                              return d <= 0 ? (
                                <span style={{ color: 'var(--color-danger)' }}>Expired</span>
                              ) : (
                                <span>{d} days</span>
                              )
                            })()}
                          </td>
                          <td>
                            <span className={`badge ${
                              item.bucketVal === 'Good' ? 'badge-success' : item.bucketVal === 'Damaged' ? 'badge-danger' : 'badge-warning'
                            }`}>
                              {item.bucketVal}
                            </span>
                          </td>
                          <td><strong>{item.availableQty.toLocaleString()}</strong></td>
                          <td>
                            <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); drillToBatch(item); }}>
                              View Detail Drawer →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* 6. Side Drawer for Batch Details */}
      <Drawer
        open={drawerOpen}
        onClose={closeBatchDetails}
        title={selectedBatchItem?.skuName || ''}
        subtitle={`${selectedBatchItem?.skuCode || ''} · ${selectedBatchItem?.batch || ''}`}
      >
        {selectedBatchItem && (
          <>
            {/* General Info */}
            <DrawerSection title="General Information" icon={Package}>
              <DetailGrid items={[
                ['SKU Code',       selectedBatchItem.skuCode],
                ['SKU Name',       selectedBatchItem.skuName],
                ['Brand',          selectedBatchItem.brand],
                ['Category',       selectedBatchItem.category],
                ['Classification', selectedBatchItem.classification],
                ['Unit of Measure',selectedBatchItem.uom],
              ]}/>
            </DrawerSection>

            {/* Storage Info */}
            <DrawerSection title="Storage Information" icon={MapPin}>
              <DetailGrid items={[
                ['Node',              selectedBatchItem.node],
                ['Location',          selectedBatchItem.location],
                ['Storage Condition', selectedBatchItem.storageCondition],
                ['Shelf Life',        `${selectedBatchItem.shelfLife} Months`],
              ]}/>
            </DrawerSection>

            {/* Inventory Quantities */}
            <DrawerSection title="Inventory Quantities" icon={Layers}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  { label:'On Hand Quantity', val: selectedBatchItem.onHandQty ?? Math.round(selectedBatchItem.availableQty * 0.85), color:'var(--color-success)' },
                  { label:'Open Sales Orders',  val: selectedBatchItem.reservedQty,  color:'var(--color-warning)' },
                  { label:'In Transit Quantity', val: selectedBatchItem.inTransitQty ?? (selectedBatchItem.availableQty - Math.round(selectedBatchItem.availableQty * 0.85)), color:'var(--color-info)' },
                  { label:'Available Inventory Position (Available IP)', val: selectedBatchItem.availableQty, color:'var(--color-primary-light)' },
                ].map(q => (
                  <div key={q.label} style={{ textAlign:'center', padding:'12px 8px', background:'var(--color-surface-hover)', borderRadius:8 }}>
                    <div style={{ fontSize:22, fontWeight:800, color:q.color }}>{q.val.toLocaleString()}</div>
                    <div style={{ fontSize:10, color:'var(--color-text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginTop:2 }}>{q.label}</div>
                  </div>
                ))}
              </div>
            </DrawerSection>

            {/* Batch Info */}
            <DrawerSection title="Batch Information" icon={Tag}>
              <DetailGrid items={[
                ['Batch Number',       selectedBatchItem.batch],
                ['Manufacturing Date', selectedBatchItem.mfgDate],
                ['Expiry Date',        selectedBatchItem.expiry],
                ['Remaining Days',     (() => { const d = daysUntil(selectedBatchItem.expiry); return d <= 0 ? 'Expired' : `${d} days` })()],
                ['Inventory Type',     'FEFO'],
                ['Bucket',             selectedBatchItem.bucketVal],
              ]}/>
              {(() => {
                const d = daysUntil(selectedBatchItem.expiry)
                if (d <= 0) return <div className="badge badge-danger" style={{ display:'inline-flex', marginTop:8 }}>⚠️ This batch is expired</div>
                if (d <= 30) return <div className="badge badge-danger" style={{ display:'inline-flex', marginTop:8 }}>⚠️ Expiring in {d} days</div>
                if (d <= 90) return <div className="badge badge-warning" style={{ display:'inline-flex', marginTop:8 }}>Near expiry — {d} days remaining</div>
                return null
              })()}
            </DrawerSection>

            {/* Movement History */}
            <DrawerSection title="Movement History" icon={Activity}>
              <MovementHistory skuCode={selectedBatchItem.skuCode} />
            </DrawerSection>
          </>
        )}
      </Drawer>
    </div>
  )
}
