import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { Boxes, Eye, EyeOff, Lock, User } from 'lucide-react'
import styles from './Login.module.css'

export default function Login() {
  const { login, node } = useApp()
  const navigate = useNavigate()

  const [form, setForm]         = useState({ username: '', password: '' })
  const [error, setError]       = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = e => {
    e.preventDefault()
    setError('')
    const ok = login(form.username, form.password)
    if (!ok) { setError('Invalid credentials. Try admin / admin123'); return }
    setLoading(true)
    // Show loading screen then navigate
    setTimeout(() => {
      setLoggedIn(true)
      setTimeout(() => navigate('/app/inventory'), 1500)
    }, 1800)
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingCard}>
          <div className={styles.spinner} />
          {!loggedIn ? (
            <>
              <p className={styles.loadingMsg}>Authenticating...</p>
              <p className={styles.loadingNode}>Connecting to system</p>
            </>
          ) : (
            <>
              <p className={styles.loadingMsg}>Login Successful</p>
              <p className={styles.loadingNode}>Working Node: <strong>{node}</strong></p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.bgDecor1} />
      <div className={styles.bgDecor2} />

      <div className={styles.card}>
        {/* Header */}
        <div className={styles.logoRow}>
          <div className={styles.logoIcon}><Boxes size={22} /></div>
          <span className={styles.logoText}>InventiQ</span>
        </div>

        <h2 className={styles.title}>Sign In</h2>
        <p className={styles.subtitle}>
          Node: <strong className={styles.nodeHighlight}>{node || '–'}</strong>
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {/* Username */}
          <div className={styles.field}>
            <label className={styles.label}>Username</label>
            <div className={styles.inputWrap}>
              <User size={16} className={styles.inputIcon} />
              <input
                type="text"
                name="username"
                className={styles.input}
                placeholder="Enter username"
                value={form.username}
                onChange={handleChange}
                required
                autoComplete="username"
              />
            </div>
          </div>

          {/* Password */}
          <div className={styles.field}>
            <label className={styles.label}>Password</label>
            <div className={styles.inputWrap}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                type={showPwd ? 'text' : 'password'}
                name="password"
                className={styles.input}
                placeholder="Enter password"
                value={form.password}
                onChange={handleChange}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowPwd(p => !p)}
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submitBtn}>
            Sign In
          </button>
        </form>

        <p className={styles.hint}>
          Demo credentials: <code>admin</code> / <code>admin123</code>
        </p>
      </div>
    </div>
  )
}
