import { NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import {
  LayoutDashboard, Package, BookOpen, MapPin, Upload,
  Layers, BarChart2, Lightbulb, Settings, LogOut,
  ChevronLeft, ChevronRight, Boxes, PackageCheck, Send, RefreshCw, PieChart
} from 'lucide-react'
import styles from './Sidebar.module.css'

// Order reflects client-confirmed priority (review call fix): most
// frequently-used items first (Dashboard, Fill Rate Intelligence,
// Replenishment, Inventory Snapshot), setup/low-frequency items last.
// Location Hierarchy is deprioritized (not removed); Data Upload sits at
// the very end, immediately before Logout - now disabled (see below),
// matching Outbound's inert/muted treatment: no `to`, no click handler,
// no badge or tooltip, just the same navItemDisabled muted styling.
const NAV_ITEMS = [
  { to: '/app/dashboard',icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/app/fill-rate', icon: PieChart,       label: 'Fill Rate Intelligence' },
  { to: '/app/replenishment', icon: RefreshCw, label: 'Replenishment' },
  { to: '/app/inventory',icon: Package,         label: 'Inventory Snapshot' },
  { to: '/app/inbound', icon: PackageCheck, label: 'Inbound' },
  { icon: Send, label: 'Outbound', disabled: true },
  { to: '/app/sku-explore',icon: BookOpen,       label: 'SKU Explore' },
  { to: '/app/batches',  icon: Layers,          label: 'Batch Tracking' },
  { to: '/app/capacity', icon: BarChart2,       label: 'Capacity Utilization' },
  { to: '/app/insights', icon: Lightbulb,       label: 'Inventory Insights' },
  { to: '/app/locations', icon: MapPin,         label: 'Location Hierarchy' },
  { to: '/app/settings', icon: Settings,        label: 'Settings' },
  { icon: Upload, label: 'Data Upload', disabled: true },
]

export default function Sidebar() {
  const { node, logout, sidebarCollapsed, setSidebarCollapsed } = useApp()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ''}`}>
      {/* Logo & Brand */}
      <div className={styles.brand}>
        <div className={styles.brandIcon}>
          <Boxes size={20} />
        </div>
        {!sidebarCollapsed && (
          <div className={styles.brandText}>
            <span className={styles.brandName}>InventiQ</span>
            <span className={styles.brandTag}>Enterprise</span>
          </div>
        )}
      </div>

      {/* Working Node Label */}
      {!sidebarCollapsed && node && (
        <div className={styles.nodeLabel}>
          <div className={styles.nodeDot} />
          <div className={styles.nodeText}>
            <span className={styles.nodeSubLabel}>Working Node</span>
            <span className={styles.nodeName}>{node}</span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className={styles.nav}>
        {NAV_ITEMS.map(({ to, icon: Icon, label, exact, disabled }) => (
          disabled ? (
            <button
              key={label}
              type="button"
              className={`${styles.navItem} ${styles.navItemDisabled}`}
              disabled
            >
              <Icon size={18} className={styles.navIcon} />
              {!sidebarCollapsed && <span className={styles.navLabel}>{label}</span>}
            </button>
          ) : (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
              title={sidebarCollapsed ? label : undefined}
            >
              <Icon size={18} className={styles.navIcon} />
              {!sidebarCollapsed && <span className={styles.navLabel}>{label}</span>}
            </NavLink>
          )
        ))}
      </nav>

      {/* Footer: Logout + Collapse */}
      <div className={styles.sidebarFooter}>
        <button
          className={styles.navItem}
          onClick={handleLogout}
          title={sidebarCollapsed ? 'Logout' : undefined}
        >
          <LogOut size={18} className={styles.navIcon} />
          {!sidebarCollapsed && <span className={styles.navLabel}>Logout</span>}
        </button>

        <button
          className={styles.collapseBtn}
          onClick={() => setSidebarCollapsed(c => !c)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  )
}
