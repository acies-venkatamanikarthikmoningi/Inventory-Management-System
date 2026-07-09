import { useEffect } from 'react'
import { X, Package, MapPin, Clock, Activity } from 'lucide-react'
import styles from './Drawer.module.css'

/* ── Reusable right-side drawer component ─────────────
   Props:
     open    – boolean
     onClose – () => void
     title   – string
     subtitle – string
     children – React nodes
   ─────────────────────────────────────────────────── */
export default function Drawer({ open, onClose, title, subtitle, children, width = 520 }) {
  /* Lock body scroll when open */
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  /* Close on Escape */
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`${styles.backdrop} ${open ? styles.backdropOpen : ''}`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}
        style={{ width }}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>
            <h3 className={styles.titleText}>{title}</h3>
            {subtitle && <p className={styles.subtitleText}>{subtitle}</p>}
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close drawer">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className={styles.drawerContent}>
          {children}
        </div>
      </div>
    </>
  )
}

/* ── Drawer Section helper ─────────────────────────── */
export function DrawerSection({ title, icon: Icon, children }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        {Icon && <Icon size={15} className={styles.sectionIcon} />}
        <span className={styles.sectionTitle}>{title}</span>
      </div>
      {children}
    </div>
  )
}

/* ── Detail Grid Row ────────────────────────────────── */
export function DetailGrid({ items }) {
  return (
    <div className={styles.detailGrid}>
      {items.map(([label, value]) => (
        <div key={label} className={styles.detailCell}>
          <span className={styles.detailLabel}>{label}</span>
          <span className={styles.detailValue}>{value ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Movement History dummy ─────────────────────────── */
export function MovementHistory({ skuCode }) {
  const movements = [
    { date: '2026-06-30', action: 'Purchase Order Receipt', qty: '+500', from: 'Supplier', to: 'Storage Bin' },
    { date: '2026-06-28', action: 'Goods Issue',             qty: '-80',  from: 'Storage Bin', to: 'Dispatch Lane' },
    { date: '2026-06-26', action: 'Stock Transfer',          qty: '0',    from: 'Storage Bin A', to: 'Storage Bin B' },
    { date: '2026-06-20', action: 'Scrapping',               qty: '-4',   from: 'Storage Bin', to: 'Scrap Area' },
  ]
  return (
    <div className={styles.movementList}>
      {movements.map((m, i) => (
        <div key={i} className={styles.movementRow}>
          <div className={styles.movementDot} data-type={m.qty.startsWith('+') ? 'in' : m.qty === '0' ? 'neutral' : 'out'} />
          <div className={styles.movementContent}>
            <div className={styles.movementAction}>{m.action}</div>
            <div className={styles.movementDetail}>{m.from} → {m.to}</div>
          </div>
          <div className={styles.movementRight}>
            <span className={styles.movementQty} data-pos={m.qty.startsWith('+') ? 'true' : 'false'}>{m.qty}</span>
            <span className={styles.movementDate}>{m.date}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
