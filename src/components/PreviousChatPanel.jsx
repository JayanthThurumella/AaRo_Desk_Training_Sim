import ChatWindow from './ChatWindow'
import InternalNotes from './InternalNotes'

/**
 * Read-only view of what happened on a ticket *before* it was reopened.
 * When a customer reopens a resolved/unresolved/abandoned ticket, a brand
 * new conversation row is created (see reopen_ticket_new_session in
 * supabase/8_enhancements.sql) and linked back via parent_conversation_id.
 * Whichever agent picks up that new ticket previously had no way to see
 * the earlier conversation or the internal notes left on it — this panel
 * fetches both, read-only, by conversationId (the parent's id).
 */
export default function PreviousChatPanel({ conversationId }) {
  if (!conversationId) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--muted)]">
        No previous conversation for this ticket.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 border-b border-[var(--line)]">
        <ChatWindow
          conversationId={conversationId}
          readOnly
          hideHeader
          emptyLabel="No messages in the previous conversation."
        />
      </div>
      <div className="shrink-0 border-b border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Internal notes before reopening
      </div>
      <div className="h-44 shrink-0 overflow-hidden">
        <InternalNotes conversationId={conversationId} readOnly />
      </div>
    </div>
  )
}