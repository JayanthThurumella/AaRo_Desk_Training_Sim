import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const HOME_BY_ROLE = {
  admin: '/admin',
  senior_agent: '/senior',
  agent: '/agent',
  customer: '/support',
}

export function ProtectedRoute({ roles, children }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />
  if (!profile) return <FullScreenLoader />

  if (roles && !roles.includes(profile.role)) {
    return <Navigate to={HOME_BY_ROLE[profile.role] ?? '/login'} replace />
  }

  return children
}

export function FullScreenLoader() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-[var(--paper)]">
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <span className="signal-bars text-[var(--brand)]">
          <span></span><span></span><span></span><span></span>
        </span>
        <span className="text-sm font-medium">Loading…</span>
      </div>
    </div>
  )
}
