import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import AppLayout from './components/Layout/AppLayout'
import Welcome from './pages/Welcome/Welcome'
import NodeSelection from './pages/NodeSelection/NodeSelection'
import Login from './pages/Login/Login'
import Dashboard from './pages/Dashboard/Dashboard'
import InventorySnapshot from './pages/InventorySnapshot/InventorySnapshot'
import SKUMaster from './pages/SKUMaster/SKUMaster'
import LocationHierarchy from './pages/LocationHierarchy/LocationHierarchy'
import Inbound from './pages/Inbound/Inbound'
import Replenishment from './pages/Replenishment/Replenishment'
import BatchTracking from './pages/BatchTracking/BatchTracking'
import CapacityUtilization from './pages/CapacityUtilization/CapacityUtilization'
import InventoryInsights from './pages/InventoryInsights/InventoryInsights'
import FillRateIntelligence from './pages/FillRateIntelligence/FillRateIntelligence'
import Settings from './pages/Settings/Settings'
import ToastContainer from './components/Toast/ToastContainer'

/* ── Route Guards ───────────────────────────────────────── */
function PrivateRoute({ children }) {
  const { user, node } = useApp()
  if (!user) return <Navigate to="/" replace />
  if (!node) return <Navigate to="/select-node" replace />
  return children
}

function PublicRoute({ children }) {
  const { user, node } = useApp()
  if (user && node) {
    const lastPath = localStorage.getItem('inventiq_last_path') || '/app/inventory'
    return <Navigate to={lastPath} replace />
  }
  if (user && !node) {
    return <Navigate to="/select-node" replace />
  }
  return children
}

/* ── Router ──────────────────────────────────────────────── */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicRoute><Welcome /></PublicRoute>} />
      <Route path="/select-node" element={<NodeSelection />} />
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/app" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
        <Route index element={<Navigate to="inventory" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="inventory" element={<InventorySnapshot />} />
        <Route path="sku-explore" element={<SKUMaster />} />
        <Route path="locations" element={<LocationHierarchy />} />
        <Route path="inbound" element={<Inbound />} />
        <Route path="replenishment" element={<Replenishment />} />
        <Route path="batches" element={<BatchTracking />} />
        <Route path="capacity" element={<CapacityUtilization />} />
        <Route path="insights" element={<InventoryInsights />} />
        <Route path="fill-rate" element={<FillRateIntelligence />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppRoutes />
        <ToastContainer />
      </BrowserRouter>
    </AppProvider>
  )
}
