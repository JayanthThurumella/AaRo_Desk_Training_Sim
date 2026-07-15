import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

const OPTIONS = [
  { value: 'available', label: 'Available', dot: 'bg-[var(--status-active)]' },
  { value: 'busy', label: 'Busy', dot: 'bg-[var(--status-hold)]' },
  { value: 'break', label: 'On break', dot: 'bg-[var(--signal)]' },
  { value: 'offline', label: 'Offline', dot: 'bg-[var(--status-cancelled)]' },
]

export default function PresenceSwitcher() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const current = OPTIONS.find((o) => o.value === profile?.status) ?? OPTIONS[3]

  const change = async (status) => {
    setOpen(false)
    if (status === profile?.status) return
    setBusy(true)
    const { error } = await supabase.rpc('set_presence', { p_status: status })
    setBusy(false)
    if (error) console.error('Failed to update presence', error)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] hover:border-[var(--brand-bright)]"
      >
        <span className={`h-2 w-2 rounded-full ${current.dot}`} />
        {current.label}
        <svg width="12" height="12" viewBox="0 0 12 12" className="text-[var(--muted)]">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-lg">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => change(o.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--paper)]"
              >
                <span className={`h-2 w-2 rounded-full ${o.dot}`} />
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
