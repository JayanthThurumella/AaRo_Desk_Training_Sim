import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ProtectedRoute, FullScreenLoader } from './routes/ProtectedRoute'
import Login from './pages/Login'
import SupportPage from './pages/customer/SupportPage'
import AgentDashboard from './pages/agent/AgentDashboard'
import SeniorDashboard from './pages/senior/SeniorDashboard'
import AdminDashboard from './pages/admin/AdminDashboard'

function RootRedirect() {
  const { loading, session, profile } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace />
  const dest = { admin: '/admin', senior_agent: '/senior', agent: '/agent', customer: '/support' }[profile?.role]
  return <Navigate to={dest ?? '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/support"
            element={
              <ProtectedRoute roles={['customer']}>
                <SupportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agent"
            element={
              <ProtectedRoute roles={['agent']}>
                <AgentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/senior"
            element={
              <ProtectedRoute roles={['senior_agent']}>
                <SeniorDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
