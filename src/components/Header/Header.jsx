import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import {
  Bell, Search, ChevronDown, User, LogOut, Settings,
  Moon, Sun, X, Package, Layers, MapPin, BarChart2, CheckCircle, AlertTriangle, Info
} from 'lucide-react'
import inventoryData from '../../data/inventory.json'
import batchData     from '../../data/batches.json'
import skuData       from '../../data/sku.json'
import styles from './Header.module.css'

/* ── Breadcrumb map ─────────────────────────────────── */
const BREADCRUMB_MAP = {
  '/app':            ['Dashboard'],
  '/app/dashboard':  ['Dashboard'],
  '/app/inventory':  ['Inventory', 'Inventory Snapshot'],
  '/app/sku-explore': ['Inventory', 'SKU Explore'],
  '/app/locations':  ['Warehouse', 'Location Hierarchy'],
  '/app/data-upload':['Operations', 'Data Upload'],
  '/app/batches':    ['Operations', 'Batch Tracking'],
  '/app/capacity':   ['Analytics', 'Capacity Utilization'],
  '/app/insights':   ['Analytics', 'Inventory Insights'],
  '/app/settings':   ['Configuration', 'Settings'],
}

/* ── Notification data ──────────────────────────────── */
let NOTIF_ID = 0
const makeNotifs = () => [
  { id:++NOTIF_ID, type:'danger',  msg:'SKU-1007 critically low (20 units remaining)',       time:'5m ago',  read:false, ts: Date.now() - 5*60000 },
  { id:++NOTIF_ID, type:'danger',  msg:'BATCH-2024-004 expiring in 5 days',                  time:'1h ago',  read:false, ts: Date.now() - 60*60000 },
  { id:++NOTIF_ID, type:'warning', msg:'Zone 4 Cold Storage at 92% utilization',             time:'2h ago',  read:false, ts: Date.now() - 120*60000 },
  { id:++NOTIF_ID, type:'success', msg:'Data upload inventory_jun30.csv completed (142 records)', time:'3h ago', read:true, ts: Date.now() - 180*60000 },
  { id:++NOTIF_ID, type:'info',    msg:'Replenishment PO-2024-0710 received at receiving dock', time:'5h ago', read:true, ts: Date.now() - 300*60000 },
  { id:++NOTIF_ID, type:'warning', msg:'SKU-1002 Surgical Gloves below minimum stock level',  time:'6h ago',  read:true, ts: Date.now() - 360*60000 },
]

const NOTIF_ICONS = {
  danger:  <AlertTriangle size={14} />,
  warning: <AlertTriangle size={14} />,
  success: <CheckCircle  size={14} />,
  info:    <Info         size={14} />,
}

/* ── Global search index ────────────────────────────── */
const buildSearchIndex = () => {
  const results = []
  inventoryData.forEach(i => {
    results.push({ label: `${i.skuCode} — ${i.skuName}`, sub: `${i.location} · ${i.status}`, icon: Package,  path: '/app/inventory', type:'Inventory' })
  })
  batchData.forEach(b => {
    results.push({ label: b.batchNumber, sub: `${b.skuName} · ${b.node.split(' ')[0]}`, icon: Layers, path: '/app/batches', type:'Batch' })
  })
  skuData.forEach(s => {
    results.push({ label: `${s.skuCode} — ${s.skuName}`, sub: `${s.category} · ${s.brand}`, icon: Package, path: '/app/sku-master', type:'SKU Master' })
  })
  results.push({ label:'Zone 4 — Cold Storage',  sub:'Chennai DC · 92% utilized', icon: MapPin,    path:'/app/locations', type:'Location' })
  results.push({ label:'Zone 1 — General Storage',sub:'Chennai DC · 80% utilized', icon: MapPin,    path:'/app/locations', type:'Location' })
  results.push({ label:'Capacity Utilization',   sub:'Analytics · Warehouse zones', icon: BarChart2, path:'/app/capacity',  type:'Analytics' })
  return results
}

const SEARCH_INDEX = buildSearchIndex()

export default function Header() {
  const { user, node, theme, toggleTheme, logout } = useApp()
  const location = useLocation()
  const navigate  = useNavigate()

  const [showNotif,   setShowNotif]   = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showSearch,  setShowSearch]  = useState(false)
  const [searchQ,     setSearchQ]     = useState('')
  const [notifications, setNotifications] = useState(makeNotifs)

  const searchRef = useRef(null)
  const crumbs    = BREADCRUMB_MAP[location.pathname] || []
  const unread    = notifications.filter(n => !n.read).length

  /* Auto-focus search input */
  useEffect(() => {
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 50)
  }, [showSearch])

  /* Close panels on Escape */
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') { setShowSearch(false); setShowNotif(false); setShowProfile(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  /* Search results */
  const searchResults = searchQ.length >= 2
    ? SEARCH_INDEX.filter(r =>
        r.label.toLowerCase().includes(searchQ.toLowerCase()) ||
        r.sub.toLowerCase().includes(searchQ.toLowerCase()) ||
        r.type.toLowerCase().includes(searchQ.toLowerCase())
      ).slice(0, 8)
    : []

  const groupedResults = searchResults.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = []
    acc[r.type].push(r)
    return acc
  }, {})

  /* Notification helpers */
  const markRead = id => setNotifications(prev => prev.map(n => n.id===id ? { ...n, read:true } : n))
  const clearAll = () => setNotifications(prev => prev.map(n => ({ ...n, read:true })))
  const deleteN  = id => setNotifications(prev => prev.filter(n => n.id !== id))

  return (
    <>
      <header className={styles.header}>
        {/* Breadcrumb */}
        <div className={styles.breadcrumb}>
          <span className={styles.breadcrumbRoot}>InventiQ</span>
          {crumbs.map((c, i) => (
            <span key={i} className={styles.breadcrumbItem}>
              <span className={styles.breadcrumbSep}>/</span>
              <span className={i === crumbs.length - 1 ? styles.breadcrumbActive : ''}>{c}</span>
            </span>
          ))}
        </div>

        {/* Right Controls */}
        <div className={styles.actions}>
          {/* Search Icon */}
          <button className={styles.iconBtn} onClick={() => setShowSearch(true)} title="Global Search (/)">
            <Search size={17} />
          </button>

          {/* Theme */}
          <button className={styles.iconBtn} onClick={toggleTheme} title="Toggle theme">
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>

          {/* Notifications */}
          <div className={styles.relativeContainer}>
            <button
              className={styles.iconBtn}
              onClick={() => { setShowNotif(p => !p); setShowProfile(false) }}
              title="Notifications"
            >
              <Bell size={17} />
              {unread > 0 && <span className={styles.badge}>{unread}</span>}
            </button>

            {showNotif && (
              <div className={styles.dropdown} style={{ width: 340 }}>
                <div className={styles.dropdownHeader}>
                  <div>
                    <span className={styles.dropdownTitle}>Notifications</span>
                    {unread > 0 && <span className={styles.unreadBadge}>{unread} new</span>}
                  </div>
                  <button className={styles.clearAllBtn} onClick={clearAll}>Mark all read</button>
                </div>
                <div className={styles.notifList}>
                  {notifications.map(n => (
                    <div key={n.id} className={`${styles.notifItem} ${n.read ? styles.notifRead : ''}`}>
                      <span className={`${styles.notifIcon} ${styles[n.type]}`}>
                        {NOTIF_ICONS[n.type]}
                      </span>
                      <div className={styles.notifContent}>
                        <p className={styles.notifMsg}>{n.msg}</p>
                        <span className={styles.notifTime}>{n.time}</span>
                      </div>
                      <div className={styles.notifActions}>
                        {!n.read && (
                          <button className={styles.markReadBtn} onClick={() => markRead(n.id)} title="Mark read">
                            <CheckCircle size={12} />
                          </button>
                        )}
                        <button className={styles.deleteBtn} onClick={() => deleteN(n.id)} title="Dismiss">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {notifications.length === 0 && (
                    <div className={styles.notifEmpty}>
                      <CheckCircle size={24} />
                      <span>All caught up!</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile */}
          <div className={styles.relativeContainer}>
            <button
              className={styles.profileBtn}
              onClick={() => { setShowProfile(p => !p); setShowNotif(false) }}
            >
              <div className={styles.avatar}>{user?.avatar || 'U'}</div>
              <div className={styles.profileInfo}>
                <span className={styles.profileName}>{user?.name}</span>
                <span className={styles.profileRole}>{user?.role}</span>
              </div>
              <ChevronDown size={13} className={styles.chevron} />
            </button>

            {showProfile && (
              <div className={styles.dropdown} style={{ minWidth: 220 }}>
                <div className={styles.dropdownHeader}>
                  <span className={styles.dropdownTitle}>{user?.name}</span>
                  <span className={styles.dropdownSub}>{node}</span>
                </div>
                <div className={styles.dropdownMenu}>
                  <button className={styles.dropdownItem} onClick={() => { navigate('/app/settings'); setShowProfile(false) }}>
                    <User size={14} /> My Profile
                  </button>
                  <button className={styles.dropdownItem} onClick={() => { navigate('/app/settings'); setShowProfile(false) }}>
                    <Settings size={14} /> Preferences
                  </button>
                  <hr className={styles.dropdownDivider} />
                  <button className={`${styles.dropdownItem} ${styles.dangerItem}`} onClick={() => { logout(); navigate('/'); }}>
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Click-away */}
        {(showNotif || showProfile) && (
          <div className={styles.overlay} onClick={() => { setShowNotif(false); setShowProfile(false) }} />
        )}
      </header>

      {/* ── Global Search Overlay ───────────────────────── */}
      {showSearch && (
        <div className={styles.searchOverlay} onClick={() => { setShowSearch(false); setSearchQ('') }}>
          <div className={styles.searchModal} onClick={e => e.stopPropagation()}>
            <div className={styles.searchInputWrap}>
              <Search size={18} className={styles.searchModalIcon} />
              <input
                ref={searchRef}
                className={styles.searchModalInput}
                placeholder="Search SKU, batch, location, brand, classification..."
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
              />
              {searchQ && (
                <button className={styles.searchClearBtn} onClick={() => setSearchQ('')}>
                  <X size={16} />
                </button>
              )}
              <kbd className={styles.escKey}>ESC</kbd>
            </div>

            {searchQ.length >= 2 ? (
              searchResults.length > 0 ? (
                <div className={styles.searchResults}>
                  {Object.entries(groupedResults).map(([type, items]) => (
                    <div key={type} className={styles.resultGroup}>
                      <div className={styles.resultGroupLabel}>{type}</div>
                      {items.map((r, i) => (
                        <button
                          key={i}
                          className={styles.resultItem}
                          onClick={() => { navigate(r.path); setShowSearch(false); setSearchQ('') }}
                        >
                          <div className={styles.resultIcon}><r.icon size={15} /></div>
                          <div className={styles.resultText}>
                            <span className={styles.resultLabel}>{r.label}</span>
                            <span className={styles.resultSub}>{r.sub}</span>
                          </div>
                          <span className={styles.resultType}>{type}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.searchEmpty}>
                  <Search size={28} />
                  <p>No results for &quot;{searchQ}&quot;</p>
                </div>
              )
            ) : (
              <div className={styles.searchHint}>
                <p>Type at least 2 characters to search across inventory, batches, SKUs, and locations.</p>
                <div className={styles.searchTags}>
                  {['SKU Code', 'Batch Number', 'Brand', 'Category', 'Location', 'Classification'].map(t => (
                    <span key={t} className={styles.searchTag}>{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
