import { useNavigate } from 'react-router-dom'
import { Boxes, ArrowRight, Shield, BarChart3, Globe } from 'lucide-react'
import styles from './Welcome.module.css'

export default function Welcome() {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      {/* Background decoration */}
      <div className={styles.bgDecor1} />
      <div className={styles.bgDecor2} />

      <div className={styles.container}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoIcon}>
            <Boxes size={32} />
          </div>
          <span className={styles.logoText}>InventiQ</span>
        </div>

        {/* Hero */}
        <div className={styles.hero}>
          <div className={styles.heroBadge}>
            <Shield size={13} />
            Enterprise Grade · Secure · Scalable
          </div>
          <h1 className={styles.title}>
            Inventory Management<br />
            <span className={styles.titleAccent}>Solution</span>
          </h1>
          <p className={styles.subtitle}>
            Network Inventory Visibility Platform — Gain real-time visibility across
            your entire supply chain network with intelligent insights.
          </p>
          <button className={styles.ctaBtn} onClick={() => navigate('/select-node')}>
            Continue to Login
            <ArrowRight size={18} />
          </button>
        </div>

        {/* Feature Pills */}
        <div className={styles.features}>
          {[
            { icon: BarChart3, text: 'Real-time Analytics' },
            { icon: Globe,     text: 'Multi-Node Network' },
            { icon: Shield,    text: 'Audit & Compliance' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className={styles.featurePill}>
              <Icon size={15} />
              {text}
            </div>
          ))}
        </div>

        <p className={styles.footer}>
          Inventory Management Solution v1.0 &nbsp;·&nbsp; Enterprise Edition
        </p>
      </div>
    </div>
  )
}
