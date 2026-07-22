import FloatingChatWindow, { BASE_Z_INDEX } from './FloatingChatWindow'
import ChatWindowTaskbar from './ChatWindowTaskbar'
import TicketWindow from './TicketWindow'

/**
 * The main-panel replacement for the Agent / Senior dashboards: instead of
 * a single fixed detail panel bound to "the selected ticket", this renders
 * a blank desktop-like canvas that hosts one independent floating window
 * per open ticket, plus a taskbar for minimized/background windows.
 */
export default function ChatWorkspace({
  ticketsById,
  categoriesById,
  customersById,
  openIds,
  minimizedIds,
  activeId,
  getCascadeIndex,
  onFocus,
  onClose,
  onMinimize,
  onChanged,
  showQaReview = false,
}) {
  const taskbarWindows = openIds
    .map((id) => ticketsById.get(id))
    .filter(Boolean)
    .map((t) => ({ id: t.id, title: t.ticket_number, status: t.status }))

  return (
    <div className="relative flex-1 overflow-hidden bg-[var(--paper)]">
      {openIds.length === 0 && (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--muted)]">
          Select a ticket from the sidebar to open it in its own window.
          <br />
          You can open several at once and arrange them side by side.
        </div>
      )}

      {openIds.map((id, idx) => {
        const ticket = ticketsById.get(id)
        if (!ticket) return null
        const category = categoriesById.get(ticket.category_id)
        const customer = customersById.get(ticket.client_id)
        return (
          <FloatingChatWindow
            key={id}
            windowId={id}
            title={ticket.ticket_number}
            subtitle={customer?.full_name ?? 'Customer'}
            zIndex={BASE_Z_INDEX + idx}
            active={id === activeId}
            minimized={minimizedIds.has(id)}
            cascadeIndex={getCascadeIndex(id)}
            onFocus={() => onFocus(id)}
            onClose={() => onClose(id)}
            onMinimize={() => onMinimize(id)}
          >
            <TicketWindow
              ticket={ticket}
              category={category}
              customer={customer}
              onChanged={onChanged}
              showQaReview={showQaReview}
            />
          </FloatingChatWindow>
        )
      })}

      <ChatWindowTaskbar
        windows={taskbarWindows}
        activeId={activeId}
        minimizedIds={minimizedIds}
        onFocus={onFocus}
        onClose={onClose}
      />
    </div>
  )
}
