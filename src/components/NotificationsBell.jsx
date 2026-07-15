import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

const MESSAGE_BY_TYPE = {
  new_queue_ticket: 'A new ticket entered the queue.',
  sla_breach_warning: 'A ticket is approaching its SLA deadline.',
  customer_replied_idle: 'A customer replied and is waiting.',
  escalation_assigned: 'An escalation was assigned to you.',
  escalation_returned: 'An escalated ticket was returned to you.',
  ticket_transferred: 'A ticket was transferred to you.',
}

export default function NotificationsBell() {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false

    supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!cancelled) setItems(data ?? [])
      })

    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (payload) => setItems((prev) => [payload.new, ...prev].slice(0, 20))
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  const unread = items.filter((i) => !i.read_at).length

  const markAllRead = async () => {
    const unreadIds = items.filter((i) => !i.read_at).map((i) => i.id)
    if (unreadIds.length === 0) return
    setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unreadIds)
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v)
          if (!open) markAllRead()
        }}
        className="relative rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2 hover:border-[var(--brand-bright)]"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M10 2a5 5 0 00-5 5v2.5L3.5 12.5A1 1 0 004.3 14h11.4a1 1 0 00.8-1.5L15 9.5V7a5 5 0 00-5-5z" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M7.5 16.5a2.5 2.5 0 005 0" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--status-escalated)] px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-lg">
            {items.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-[var(--muted)]">Nothing yet.</p>
            )}
            {items.map((n) => (
              <div key={n.id} className="border-b border-[var(--line)] px-3 py-2 last:border-0">
                <p className="text-sm text-[var(--ink)]">{MESSAGE_BY_TYPE[n.type] ?? n.type}</p>
                <p className="mt-0.5 text-[11px] font-mono-data text-[var(--muted)]">
                  {new Date(n.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
