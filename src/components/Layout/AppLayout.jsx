import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../Sidebar/Sidebar'
import Header from '../Header/Header'
import { useApp } from '../../context/AppContext'
import styles from './AppLayout.module.css'

export default function AppLayout() {
  const { sidebarCollapsed } = useApp()
  const location = useLocation()

  useEffect(() => {
    if (location.pathname && location.pathname.startsWith('/app')) {
      localStorage.setItem('inventiq_last_path', location.pathname + location.search)
    }
  }, [location])

  return (
    <div className={styles.layout}>
      <Sidebar />
      <div className={`${styles.mainContent} ${sidebarCollapsed ? styles.expanded : ''}`}>
        <Header />
        <main className={styles.pageBody}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
