import { createContext, useContext, useState, useCallback } from 'react'
import baseInventoryData from '../data/inventory.json'
import inboundSeed from '../data/inbound.json'
import replenishmentConfigSeed from '../data/replenishmentConfig.json'

/* ── App Context: Auth + Theme + Toast + Node ─────────────── */
const AppContext = createContext(null)

let toastId = 0

export function AppProvider({ children }) {
  const [user, setUser]       = useState(() => {
    const saved = localStorage.getItem('inventiq_user')
    return saved ? JSON.parse(saved) : null
  })
  const [node, setNode]       = useState(() => {
    return localStorage.getItem('inventiq_node') || null
  })
  const [theme, setTheme]     = useState('light')
  const [toasts, setToasts]   = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [inventoryData, setInventoryData] = useState(baseInventoryData)
  const [asns, setAsns] = useState(inboundSeed)
  const [replenishmentConfig, setReplenishmentConfig] = useState(replenishmentConfigSeed)

  const handleSetNode = useCallback((selectedNode) => {
    setNode(selectedNode)
    if (selectedNode) {
      localStorage.setItem('inventiq_node', selectedNode)
    } else {
      localStorage.removeItem('inventiq_node')
    }
  }, [])

  // ── Auth ────────────────────────────────────────────────
  const login = useCallback((username, password) => {
    // Dummy authentication
    if (username === 'admin' && password === 'admin123') {
      const u = { username: 'admin', name: 'Fathina Iffat', role: 'Inventory Manager', avatar: 'FI' }
      setUser(u)
      localStorage.setItem('inventiq_user', JSON.stringify(u))
      return true
    }
    if (username === 'manager' && password === 'manager123') {
      const u = { username: 'manager', name: 'Ravi Kumar', role: 'Warehouse Manager', avatar: 'RK' }
      setUser(u)
      localStorage.setItem('inventiq_user', JSON.stringify(u))
      return true
    }
    return false
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    setNode(null)
    localStorage.removeItem('inventiq_user')
    localStorage.removeItem('inventiq_node')
    localStorage.removeItem('inventiq_last_path')
  }, [])

  // ── Theme ────────────────────────────────────────────────
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light'
      document.documentElement.setAttribute('data-theme', next)
      return next
    })
  }, [])

  // ── Toast ────────────────────────────────────────────────
  const showToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <AppContext.Provider value={{
      user, login, logout,
      node, setNode: handleSetNode,
      theme, toggleTheme,
      toasts, showToast, removeToast,
      sidebarCollapsed, setSidebarCollapsed,
      inventoryData, setInventoryData,
      asns, setAsns,
      replenishmentConfig, setReplenishmentConfig,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
