import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const HOME_BY_ROLE = { admin: '/admin', senior_agent: '/senior', agent: '/agent', customer: '/support' }

export default function Login() {
  const { session, profile, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [signedUp, setSignedUp] = useState(false)

  if (session && profile) {
    const dest = location.state?.from?.pathname ?? HOME_BY_ROLE[profile.role] ?? '/support'
    return <Navigate to={dest} replace />
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        navigate(location.state?.from?.pathname ?? '/support', { replace: true })
      } else {
        await signUp(email, password, fullName)
        setSignedUp(true)
      }
    } catch (err) {
      setError(err.message ?? 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--paper)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="signal-bars text-[var(--brand)]"><span></span><span></span><span></span><span></span></span>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-[var(--ink)]">Nexline Support Desk</h1>
            <p className="text-xs text-[var(--muted)] font-mono-data">Training Simulator</p>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-sm">
          {signedUp ? (
            <div className="text-center py-4">
              <p className="text-sm text-[var(--ink)] font-medium">Check your inbox to confirm your account.</p>
              <button
                onClick={() => { setSignedUp(false); setMode('signin') }}
                className="mt-4 text-sm font-semibold text-[var(--brand)]"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5 flex rounded-lg bg-[var(--paper)] p-1 text-sm font-medium">
                <button
                  onClick={() => setMode('signin')}
                  className={`flex-1 rounded-md py-1.5 ${mode === 'signin' ? 'bg-[var(--panel)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)]'}`}
                >
                  Sign in
                </button>
                <button
                  onClick={() => setMode('signup')}
                  className={`flex-1 rounded-md py-1.5 ${mode === 'signup' ? 'bg-[var(--panel)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)]'}`}
                >
                  Create account
                </button>
              </div>

              <form onSubmit={submit} className="space-y-3">
                {mode === 'signup' && (
                  <Field label="Full name" type="text" value={fullName} onChange={setFullName} required />
                )}
                <Field label="Email" type="email" value={email} onChange={setEmail} required />
                <Field label="Password" type="password" value={password} onChange={setPassword} required minLength={6} />

                {error && <p className="text-sm text-[var(--status-escalated)]">{error}</p>}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-[var(--brand)] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
                </button>

                {mode === 'signup' && (
                  <p className="text-center text-[11px] text-[var(--muted)]">
                    New accounts are created as customers. Ask an admin to grant agent access.
                  </p>
                )}
              </form>
            </>
          )}
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
