import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import {
  User, Moon, Sun, Bell, Shield, Database, Activity,
  Cpu, Brain, TrendingUp, BarChart3, Zap, Check
} from 'lucide-react'
import styles from './Settings.module.css'

const AUDIT_LOG = [
  { time:'2026-06-30 09:45', user:'admin',   action:'Inventory count completed',          module:'Inventory' },
  { time:'2026-06-30 09:00', user:'admin',   action:'File upload: inventory_jun30.csv',   module:'Data Upload' },
  { time:'2026-06-29 17:30', user:'manager', action:'SKU-1006 edited',                    module:'SKU Master' },
  { time:'2026-06-29 15:00', user:'admin',   action:'Batch BATCH-2024-004 flagged',       module:'Batch Tracking' },
  { time:'2026-06-28 11:00', user:'system',  action:'Low stock alert triggered for SKU-1007', module:'Insights' },
  { time:'2026-06-27 14:00', user:'manager', action:'Capacity simulation run',             module:'Capacity' },
  { time:'2026-06-26 09:30', user:'admin',   action:'User login',                          module:'Auth' },
]

const AI_FEATURES = [
  { id:'ai-reco',  label:'AI Inventory Recommendations', icon:Brain,     status:'Beta',     desc:'ML-powered SKU replenishment suggestions based on consumption patterns.' },
  { id:'demand',   label:'Demand Forecasting',           icon:TrendingUp,status:'Planned',  desc:'Predict future demand using seasonal and historical data.' },
  { id:'safety',   label:'Safety Stock Suggestions',     icon:Shield,    status:'Beta',     desc:'Dynamic safety stock calculation based on supplier lead time and demand variability.' },
  { id:'replen',   label:'Replenishment Suggestions',    icon:Zap,       status:'Planned',  desc:'Automated purchase order suggestions triggered by reorder point breaches.' },
  { id:'scenario', label:'Scenario Simulation',          icon:Cpu,       status:'Planned',  desc:'What-if analysis for inventory planning and capacity optimization.' },
  { id:'trend',    label:'Inventory Trend Analysis',     icon:BarChart3, status:'Beta',     desc:'Visual trend analysis across SKUs, nodes, and time periods.' },
]

export default function Settings() {
  const { user, theme, toggleTheme, node, showToast } = useApp()

  const [notifSettings, setNotifSettings] = useState({
    lowStock:    true,
    nearExpiry:  true,
    overCapacity:true,
    dataUpload:  true,
    system:      false,
  })

  const toggle = key => setNotifSettings(p => ({ ...p, [key]: !p[key] }))

  const handleSave = () => showToast('Settings saved successfully', 'success')

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2>Settings</h2>
          <p>Application preferences, notifications, and account management</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary btn-sm" onClick={handleSave}>
            <Check size={14} /> Save Changes
          </button>
        </div>
      </div>

      <div className={styles.settingsGrid}>
        {/* Profile */}
        <div className="card">
          <div className="card-header"><span className="card-title"><User size={15}/> User Profile</span></div>
          <div className={styles.profileCard}>
            <div className={styles.profileAvatar}>{user?.avatar || 'U'}</div>
            <div className={styles.profileInfo}>
              <h3>{user?.name}</h3>
              <p>{user?.role}</p>
              <span className="badge badge-primary">{user?.username}</span>
            </div>
          </div>
          <hr className="divider"/>
          <div className={styles.fieldGrid}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" defaultValue={user?.name} />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <input className="form-input" defaultValue={user?.role} readOnly />
            </div>
            <div className="form-group">
              <label className="form-label">Working Node</label>
              <input className="form-input" defaultValue={node} readOnly />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" defaultValue={`${user?.username}@inventiq.com`} />
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="card">
          <div className="card-header"><span className="card-title"><Sun size={15}/> Appearance</span></div>
          <div className={styles.themeRow}>
            {['light','dark'].map(t => (
              <button
                key={t}
                className={`${styles.themeOption} ${theme===t?styles.themeActive:''}`}
                onClick={() => { if (theme !== t) toggleTheme() }}
              >
                {t === 'light' ? <Sun size={20}/> : <Moon size={20}/>}
                <span>{t === 'light' ? 'Light Mode' : 'Dark Mode'}</span>
                {theme === t && <span className="badge badge-success" style={{ fontSize:10 }}>Active</span>}
              </button>
            ))}
          </div>
          <hr className="divider"/>
          <div className="form-group">
            <label className="form-label">Language</label>
            <select className="form-select" defaultValue="en">
              <option value="en">English (US)</option>
              <option value="hi">Hindi</option>
              <option value="ta">Tamil</option>
            </select>
          </div>
          <div className="form-group" style={{ marginTop:12 }}>
            <label className="form-label">Date Format</label>
            <select className="form-select" defaultValue="dd-mm-yyyy">
              <option>DD-MM-YYYY</option>
              <option>MM/DD/YYYY</option>
              <option>YYYY-MM-DD</option>
            </select>
          </div>
        </div>

        {/* Notifications */}
        <div className="card">
          <div className="card-header"><span className="card-title"><Bell size={15}/> Notification Preferences</span></div>
          <div className={styles.notifList}>
            {[
              { key:'lowStock',    label:'Low Stock Alerts',     desc:'Alert when SKU stock drops below minimum level' },
              { key:'nearExpiry',  label:'Near Expiry Alerts',   desc:'Alert when batches are within 90 days of expiry' },
              { key:'overCapacity',label:'Over Capacity Alerts', desc:'Alert when warehouse utilization exceeds 85%' },
              { key:'dataUpload',  label:'Data Upload Events',   desc:'Notification for completed uploads' },
              { key:'system',      label:'System Notifications', desc:'Scheduled maintenance and system events' },
            ].map(n => (
              <div key={n.key} className={styles.notifRow}>
                <div className={styles.notifText}>
                  <div className={styles.notifLabel}>{n.label}</div>
                  <div className={styles.notifDesc}>{n.desc}</div>
                </div>
                <button
                  className={`${styles.toggle} ${notifSettings[n.key] ? styles.toggleOn : ''}`}
                  onClick={() => toggle(n.key)}
                >
                  <div className={styles.toggleThumb}/>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* AI Features */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Brain size={15}/> Future-Ready AI Features</span>
            <span className="badge badge-warning">Coming Soon</span>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom:16 }}>
            These enterprise AI capabilities are planned for upcoming releases. Preview their specifications below.
          </p>
          <div className={styles.aiList}>
            {AI_FEATURES.map(f => (
              <div key={f.id} className={styles.aiItem}>
                <div className={styles.aiIcon}>
                  <f.icon size={16}/>
                </div>
                <div className={styles.aiContent}>
                  <div className={styles.aiLabel}>
                    {f.label}
                    <span className={`badge ${f.status==='Beta'?'badge-warning':'badge-default'}`} style={{ fontSize:9 }}>
                      {f.status}
                    </span>
                  </div>
                  <div className={styles.aiDesc}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Audit Log */}
        <div className="card" style={{ gridColumn:'1/-1' }}>
          <div className="card-header">
            <span className="card-title"><Activity size={15}/> Audit Log</span>
            <span className="text-sm text-muted">Last 7 entries</span>
          </div>
          <div className="table-container" style={{ border:'none' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Module</th>
                </tr>
              </thead>
              <tbody>
                {AUDIT_LOG.map((log, i) => (
                  <tr key={i}>
                    <td className="text-sm text-muted" style={{ fontFamily:'monospace' }}>{log.time}</td>
                    <td>
                      <div className={styles.auditUser}>
                        <div className={styles.auditAvatar}>{log.user[0].toUpperCase()}</div>
                        {log.user}
                      </div>
                    </td>
                    <td className="text-sm">{log.action}</td>
                    <td><span className="badge badge-default">{log.module}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
