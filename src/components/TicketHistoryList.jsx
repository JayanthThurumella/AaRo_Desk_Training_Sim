import { PriorityBadge } from './StatusBadge'
import { formatDuration, firstResponseSeconds, handleTimeSeconds, resolutionSeconds } from '../utils/kpi'

export default function TicketHistoryList({ tickets, categories, selectedId, onSelect }) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  if (tickets.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">No completed tickets yet.</p>
  }

  return (
    <ul className="divide-y divide-[var(--line)]">
      {tickets.map((t) => {
        const category = categoryById.get(t.category_id)
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
              <span>Handle: {formatDuration(handleTimeSeconds(t))}</span>
              <span>Resolution: {formatDuration(resolutionSeconds(t))}</span>
              {t.csat_score && <span>CSAT: {t.csat_score}/5</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}