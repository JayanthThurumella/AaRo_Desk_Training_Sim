import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const HOME_BY_ROLE = { admin: '/admin', senior_agent: '/senior', agent: '/agent', customer: '/support' }

export default function Login() {
  const { session, profile, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (session && profile) {
    const dest = location.state?.from?.pathname ?? HOME_BY_ROLE[profile.role] ?? '/support'
    return <Navigate to={dest} replace />
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email, password)
      navigate(location.state?.from?.pathname ?? '/support', { replace: true })
    } catch (err) {
      setError(err.message ?? 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--paper)] px-4">
      <div className="w-full max-w-sm">
        

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-sm">
          {/* Centered header */}
        <div className="mb-8 flex flex-col items-center gap-1">
          <span className="signal-bars text-[var(--brand)]"><span></span><span></span><span></span><span></span></span>
          <div className="flex items-center gap-2.5">
            
            <h1 className="text-lg font-bold tracking-tight text-[var(--ink)]">AaRo Support Desk</h1>
          </div>
          <p className="text-xs text-[var(--muted)] font-mono-data">Training Simulator</p>
        </div>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email" type="email" value={email} onChange={setEmail} required />
            <Field label="Password" type="password" value={password} onChange={setPassword} required minLength={6} />

            {error && <p className="text-sm text-[var(--status-escalated)] text-center">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-[var(--brand)] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, type, value, onChange, required, minLength }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--brand-bright)] focus:outline-none"
      />
    </label>
  )
}