import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

const ROLE_LABEL = { customer: 'Customer', agent: 'Agent', senior_agent: 'Senior Agent', admin: 'Admin' }

/**
 * conversationId: uuid
 * readOnly: true disables the composer (e.g. closed ticket, or a senior agent just observing)
 * onReopenNeeded: called when a customer tries to type into a closed ticket (composer stays enabled
 *   for customers — send_reply() reopens automatically server-side per §6.8)
 *
 * The window also supports being "closed" purely as a UI/session concept — this only hides the
 * conversation locally (no writes, no status change) and is tracked per conversationId, so if this
 * same component instance is reused to view several conversations one after another (as it is in
 * TicketDetailPanel / ConversationReviewPanel), closing one never affects the others.
 */
export default function ChatWindow({ conversationId, readOnly = false, emptyLabel = 'No messages yet.' }) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [closedIds, setClosedIds] = useState(() => new Set())
  const bottomRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const hasScrolledOnceRef = useRef(false)

  const isClosed = !!conversationId && closedIds.has(conversationId)

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    hasScrolledOnceRef.current = false

    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else setMessages(data ?? [])
      })

    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setMessages((prev) => [...prev, payload.new])
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  useEffect(() => {
    if (isClosed) return
    // Jump instantly on the first render of a conversation (avoids a long smooth-scroll
    // animation racing down through history), then smooth-scroll for every message after that.
    bottomRef.current?.scrollIntoView({ behavior: hasScrolledOnceRef.current ? 'smooth' : 'auto' })
    hasScrolledOnceRef.current = true
  }, [messages.length, conversationId, isClosed])

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase.rpc('send_reply', {
      p_conversation_id: conversationId,
      p_body: body,
    })
    setSending(false)
    if (err) {
      setError(err.message)
    } else {
      setDraft('')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const closeChat = () => {
    if (!conversationId) return
    setClosedIds((prev) => {
      const next = new Set(prev)
      next.add(conversationId)
      return next
    })
  }

  const reopenChat = () => {
    if (!conversationId) return
    setClosedIds((prev) => {
      if (!prev.has(conversationId)) return prev
      const next = new Set(prev)
      next.delete(conversationId)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {isClosed ? 'Chat closed' : 'Chat'}
        </span>
        {conversationId && (
          isClosed ? (
            <button
              onClick={reopenChat}
              className="text-xs font-medium text-[var(--brand)] hover:underline"
            >
              Reopen chat
            </button>
          ) : (
            <button
              onClick={closeChat}
              className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:border-[var(--status-escalated)] hover:text-[var(--status-escalated)] transition-colors"
            >
              Close Chat
            </button>
          )
        )}
      </div>

      {isClosed ? (
        <div className="flex flex-1 min-h-0 items-center justify-center px-4 py-4">
          <div className="text-center">
            <p className="text-sm text-[var(--muted)]">This chat window is closed.</p>
            <button
              onClick={reopenChat}
              className="mt-2 text-sm font-medium text-[var(--brand)] hover:underline"
            >
              Reopen chat
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && (
              <p className="text-center text-sm text-[var(--muted)] mt-8">{emptyLabel}</p>
            )}
            {messages.map((m) => {
              const mine = m.sender_id === profile?.id
              const isBot = m.sender_role === 'customer' && m.sender_id === null
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                    mine
                      ? 'bg-[var(--brand)] text-white rounded-br-sm'
                      : 'bg-[var(--panel)] border border-[var(--line)] text-[var(--ink)] rounded-bl-sm'
                  }`}>
                    {!mine && (
                      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {isBot ? 'Nexline Bot' : ROLE_LABEL[m.sender_role] ?? m.sender_role}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <div className={`mt-1 text-[10px] font-mono-data ${mine ? 'text-white/70' : 'text-[var(--muted)]'}`}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {error && <p className="shrink-0 px-4 pb-1 text-xs text-[var(--status-escalated)]">{error}</p>}

          {!readOnly && (
            <div className="flex shrink-0 items-end gap-2 border-t border-[var(--line)] bg-[var(--panel)] p-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
                rows={1}
                className="flex-1 resize-none rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--brand-bright)] focus:outline-none max-h-32"
              />
              <button
                onClick={send}
                disabled={sending || !draft.trim()}
                className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}