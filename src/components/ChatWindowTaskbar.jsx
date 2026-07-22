import { TASKBAR_HEIGHT } from './FloatingChatWindow'

const STATUS_DOT = {
  bot: '--status-bot',
  open: '--status-open',
  assigned: '--status-assigned',
  active: '--status-active',
  on_hold: '--status-hold',
  escalated: '--status-escalated',
  pending: '--status-pending',
  resolved: '--status-resolved',
  unresolved: '--status-unresolved',
  cancelled: '--status-cancelled',
  abandoned: '--status-abandoned',
}

/**
 * Desktop-style taskbar for the multi-window workspace: one chip per open
 * ticket window (minimized or not), so an agent working several chats at
 * once can jump between or restore them without hunting across the
 * screen. Always pinned to the bottom of the workspace.
 */
export default function ChatWindowTaskbar({ windows, activeId, minimizedIds, onFocus, onClose }) {
  if (windows.length === 0) return null

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[500] flex items-center gap-2 overflow-x-auto border-t border-[var(--line)] bg-[var(--panel)] px-3"
      style={{ height: TASKBAR_HEIGHT }}
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Open ({windows.length})
      </span>
      {windows.map((w) => {
        const isMinimized = minimizedIds.has(w.id)
        const isActive = w.id === activeId
        return (
          <div
            key={w.id}
            onClick={() => onFocus(w.id)}
            className={`group flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              isActive
                ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--ink)]'
                : isMinimized
                  ? 'border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]'
                  : 'border-[var(--line)] text-[var(--ink)] hover:border-[var(--brand-bright)]'
            }`}
            title={w.title}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `var(${STATUS_DOT[w.status] ?? '--muted'})` }} />
            <span className="max-w-[140px] truncate font-mono-data">{w.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(w.id) }}
              aria-label={`Close ${w.title}`}
              className="ml-0.5 rounded text-[var(--muted)] opacity-0 hover:bg-[var(--status-escalated)] hover:text-white group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
