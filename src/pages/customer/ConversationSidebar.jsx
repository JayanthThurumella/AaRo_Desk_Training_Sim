import StatusBadge from '../../components/StatusBadge'

const TERMINAL = ['resolved', 'unresolved', 'cancelled', 'abandoned']

export default function ConversationSidebar({
  conversations,
  categories,
  selectedId,
  onSelect,
  onNewChat,
  starting,
  wide,
}) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const active = conversations
    .filter((c) => !TERMINAL.includes(c.status))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const history = conversations
    .filter((c) => TERMINAL.includes(c.status))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  return (
    <aside
      className={`flex w-full flex-col border-b border-[var(--line)] bg-[var(--panel)] transition-[width] duration-300 ease-in-out md:h-full md:border-b-0 md:border-r ${
        wide ? 'md:w-96' : 'md:w-72'
      }`}
    >
      <div className="border-b border-[var(--line)] p-4">
        <button
          onClick={onNewChat}
          disabled={starting}
          className="w-full rounded-lg bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-bright)] disabled:opacity-50"
        >
          + New Issue / New Chat
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto md:max-h-none md:flex-1">
        {active.length > 0 && (
          <div>
            <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Current
            </p>
            <ul>
              {active.map((c) => (
                <ConversationRow
                  key={c.id}
                  conv={c}
                  category={categoryById.get(c.category_id)}
                  selected={selectedId === c.id}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            History
          </p>
          {history.length === 0 ? (
            <p className="px-4 py-4 text-sm text-[var(--muted)]">No previous conversations yet.</p>
          ) : (
            <ul>
              {history.map((c) => (
                <ConversationRow
                  key={c.id}
                  conv={c}
                  category={categoryById.get(c.category_id)}
                  selected={selectedId === c.id}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  )
}

function ConversationRow({ conv, category, selected, onSelect }) {
  return (
    <li
      onClick={() => onSelect(conv)}
      className={`cursor-pointer border-b border-[var(--line)] px-4 py-3 transition-colors hover:bg-[var(--paper)] ${
        selected ? 'bg-[var(--paper)]' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono-data text-xs text-[var(--muted)]">{conv.ticket_number}</span>
        <StatusBadge status={conv.status} />
      </div>
      <p className="mt-1 truncate text-sm font-medium text-[var(--ink)]">{category?.name ?? 'General enquiry'}</p>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        {new Date(conv.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        {' · '}
        {new Date(conv.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
    </li>
  )
}