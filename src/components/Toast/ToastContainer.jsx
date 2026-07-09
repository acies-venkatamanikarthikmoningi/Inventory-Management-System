import { useApp } from '../../context/AppContext'
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react'

const ICONS = {
  success: <CheckCircle size={16} color="var(--color-success)" />,
  warning: <AlertTriangle size={16} color="var(--color-warning)" />,
  error:   <XCircle size={16} color="var(--color-danger)" />,
  info:    <Info size={16} color="var(--color-info)" />,
}

export default function ToastContainer() {
  const { toasts, removeToast } = useApp()

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {ICONS[t.type]}
          <span style={{ flex: 1, fontSize: 13 }}>{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
