import { useEffect, useState } from 'react'
import { PriorityBadge } from './StatusBadge'
import { formatDuration, firstResponseSeconds, viewerHandleTimeSeconds, resolutionSeconds } from '../utils/kpi'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

export default function TicketHistoryList({ tickets, categories, selectedId, onSelect }) {
  const { profile } = useAuth()
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  // Latest escalation row per conversation_id, used so each ticket's "Handle"
  // figure reflects only this viewer's own claim/escalation period — it never
  // keeps growing on one user's screen just because the ticket is currently
  // being worked by the other user it was escalated to/from (see
  // viewerHandleTimeSeconds in utils/kpi.js).
  const [escalationById, setEscalationById] = useState({})

  useEffect(() => {
    const ids = tickets.filter((t) => t.original_agent_id).map((t) => t.id)
    if (ids.length === 0) {
      setEscalationById({})
      return
    }
    let cancelled = false
    supabase
      .from('escalations')
      .select('conversation_id, created_at, resolved_at, to_agent_id')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled || !data) return
        const map = {}
        // Rows arrive newest-first — keep only the first (latest) one per ticket.
        for (const row of data) {
          if (!map[row.conversation_id]) map[row.conversation_id] = row
        }
        setEscalationById(map)
      })
    return () => { cancelled = true }
  }, [tickets])

  if (tickets.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">No completed tickets yet.</p>
  }

  return (
    <ul className="divide-y divide-[var(--line)]">
      {tickets.map((t) => {
        const category = categoryById.get(t.category_id)
        const handleSeconds = viewerHandleTimeSeconds(t, profile?.id, escalationById[t.id] ?? null)
        return (
          <li
            key={t.id}
            onClick={() => onSelect?.(t)}
            className={`cursor-pointer px-4 py-3 hover:bg-[var(--paper)] ${selectedId === t.id ? 'bg-[var(--paper)]' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono-data text-xs text-[var(--muted)]">{t.ticket_number}</span>
              <PriorityBadge priority={t.priority} />
            </div>
            <p className="mt-1 truncate text-sm font-medium text-[var(--ink)]">{category?.name ?? 'Uncategorized'}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono-data text-[var(--muted)]">
              <span>FRT: {formatDuration(firstResponseSeconds(t))}</span>
              <span>Handle: {formatDuration(handleSeconds)}</span>
              <span>Resolution: {formatDuration(resolutionSeconds(t))}</span>
              {t.csat_score && <span>CSAT: {t.csat_score}/5</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}