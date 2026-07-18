import StatusBadge, { PriorityBadge } from './StatusBadge'

export default function MyTicketsList({ tickets, categories, selectedId, onSelect, unreadIds }) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  if (tickets.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">No tickets in progress.</p>
  }

  return (
    <ul className="divide-y divide-[var(--line)]">
      {tickets.map((t) => {
        const category = categoryById.get(t.category_id)
        const unread = unreadIds?.has?.(t.id)
        return (
          <li
            key={t.id}
            onClick={() => onSelect?.(t)}
            className={`cursor-pointer px-4 py-3 hover:bg-[var(--paper)] ${selectedId === t.id ? 'bg-[var(--paper)]' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono-data text-xs text-[var(--muted)]">
                {unread && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]"
                    title="New message"
                    aria-label="Unread messages"
                  />
                )}
                {t.ticket_number}
              </span>
              <PriorityBadge priority={t.priority} />
            </div>
            <p className="mt-1 truncate text-sm font-medium text-[var(--ink)]">{category?.name ?? 'Uncategorized'}</p>
            <div className="mt-1.5">
              <StatusBadge status={t.status} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}