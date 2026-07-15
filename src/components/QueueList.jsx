import { supabase } from '../lib/supabaseClient'
import { PriorityBadge } from './StatusBadge'
import { isSlaAtRisk } from '../utils/kpi'

export default function QueueList({ tickets, categories, canClaim, onClaimed, selectedId, onSelect }) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const claim = async (id, e) => {
    e.stopPropagation()
    const { error } = await supabase.rpc('claim_conversation', { p_conversation_id: id })
    if (error) alert(error.message)
    else onClaimed?.(id)   // pass the claimed ticket id
  }

  if (tickets.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">Queue is empty.</p>
  }

  return (
    <ul className="divide-y divide-[var(--line)]">
      {tickets.map((t) => {
        const category = categoryById.get(t.category_id)
        const atRisk = isSlaAtRisk(t, category)
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
            <div className="mt-1 flex items-center justify-between">
              <span className={`text-[11px] font-mono-data ${atRisk ? 'text-[var(--status-escalated)] font-semibold' : 'text-[var(--muted)]'}`}>
                waiting {relativeTime(t.started_at)}{atRisk ? ' · SLA at risk' : ''}
              </span>
              {canClaim && (
                <button
                  onClick={(e) => claim(t.id, e)}
                  className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  Claim
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function relativeTime(iso) {
  if (!iso) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}