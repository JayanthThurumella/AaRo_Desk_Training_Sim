import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

const ROLE_LABEL = { customer: 'Customer', agent: 'Agent', senior_agent: 'Senior Agent', admin: 'Admin' }

// Distinct background per sender type so any reader can tell at a glance who
// sent what — the same colors are used regardless of whether the message is
// "mine" or not, so the distinction holds for every viewer (agent, senior
// agent, or admin reviewing the transcript).
const ROLE_BUBBLE = {
  customer: 'bg-[var(--msg-customer)] text-[var(--ink)]',
  agent: 'bg-[var(--msg-agent)] text-white',
  senior_agent: 'bg-[var(--msg-senior)] text-white',
  admin: 'bg-[var(--msg-admin)] text-white',
  bot: 'bg-[var(--msg-bot)] text-white',
}

// How long to wait after the last keystroke before broadcasting "stopped
// typing" — also used client-side as a safety net to auto-hide a peer's
// typing bubble if their own "stopped" event is ever missed.
const TYPING_IDLE_MS = 2000
const TYPING_STALE_MS = 4000

const STAFF_ROLES = new Set(['agent', 'senior_agent'])

// How close to the bottom (in px) counts as "already there" for the
// smart-scroll behavior — used to decide whether a new message should
// auto-scroll the view or just raise the "New messages" indicator.
const NEAR_BOTTOM_THRESHOLD = 120
// Brief pause before settling on the latest message when a ticket's chat is
// opened for the very first time, so the agent gets a moment to see where
// the conversation's history starts before we jump to the newest message.
const INITIAL_TOP_PAUSE_MS = 700

// Module-level (not per-component) set of conversation ids whose chat has
// already been opened at least once in this browser session. Floating
// ticket windows fully unmount on minimize/close, so this can't live in
// component state — it's what lets us tell "first time this ticket's chat
// is being opened" (start at the top, then settle at the bottom) apart from
// "this window was closed and reopened" (go straight to the latest message).
const seenConversationIds = new Set()

/**
 * conversationId: uuid
 * readOnly: true disables the composer (e.g. closed ticket, or a senior agent just observing)
 * hideHeader: true skips the small "Chat" label bar entirely — used inside the floating ticket
 *   windows, which already show the ticket number/customer in their own title bar and tabs, so
 *   that extra label would just be duplicate chrome eating into the message area.
 * compact: tighter padding/spacing/font sizes, used inside the agent/senior-agent floating ticket
 *   windows where screen real estate is at a premium. Defaults to false so every other surface
 *   this component is used on (customer chat, admin QA review) is unaffected.
 * smartScroll: opts into the "claim a ticket" auto-scroll behavior described below. Defaults to
 *   false, which preserves the original always-jump-to-bottom behavior used everywhere else.
 *   When enabled:
 *   - the very first time a given conversation's chat is opened, it starts at the top of the
 *     history, then settles on the latest message a moment later
 *   - reopening a chat that was already opened before (e.g. the floating window was minimized/
 *     closed and reopened) goes straight to the latest message
 *   - new messages auto-scroll the view only if the reader is already near the bottom; otherwise
 *     a "New messages" indicator appears instead of yanking the view down
 */
export default function ChatWindow({
  conversationId,
  readOnly = false,
  emptyLabel = 'No messages yet.',
  hideHeader = false,
  compact = false,
  smartScroll = false,
}) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  // Who else is currently typing, keyed by sender_id -> { role, expiresAt timeout id }
  const [typingUsers, setTypingUsers] = useState({})
  const [showNewMessages, setShowNewMessages] = useState(false)
  const bottomRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const hasScrolledOnceRef = useRef(false)
  const channelRef = useRef(null)
  const typingIdleTimerRef = useRef(null)
  const isTypingRef = useRef(false)
  const typingClearTimersRef = useRef({})
  // smartScroll-only bookkeeping (harmless/unused when smartScroll is false)
  const isNearBottomRef = useRef(true)
  const isFirstLoadRef = useRef(true)
  const prevMessageCountRef = useRef(0)
  const initialScrollTimeoutRef = useRef(null)

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    hasScrolledOnceRef.current = false
    isFirstLoadRef.current = true
    prevMessageCountRef.current = 0
    isNearBottomRef.current = true
    setShowNewMessages(false)
    if (initialScrollTimeoutRef.current) clearTimeout(initialScrollTimeoutRef.current)

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
      .channel(`messages-${conversationId}`, { config: { broadcast: { self: false } } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setMessages((prev) => [...prev, payload.new])
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.senderId === profile?.id) return
        setTypingUsers((prev) => {
          const next = { ...prev }
          if (typingClearTimersRef.current[payload.senderId]) {
            clearTimeout(typingClearTimersRef.current[payload.senderId])
          }
          if (payload.typing) {
            typingClearTimersRef.current[payload.senderId] = setTimeout(() => {
              setTypingUsers((p) => {
                const n = { ...p }
                delete n[payload.senderId]
                return n
              })
            }, TYPING_STALE_MS)
            next[payload.senderId] = { role: payload.senderRole }
          } else {
            delete next[payload.senderId]
          }
          return next
        })
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      cancelled = true
      channelRef.current = null
      Object.values(typingClearTimersRef.current).forEach(clearTimeout)
      typingClearTimersRef.current = {}
      setTypingUsers({})
      if (initialScrollTimeoutRef.current) clearTimeout(initialScrollTimeoutRef.current)
      supabase.removeChannel(channel)
    }
  }, [conversationId, profile?.id])

  useEffect(() => {
    if (!smartScroll) {
      // Original behavior: jump instantly on the first render of a conversation (avoids a long
      // smooth-scroll animation racing down through history), then smooth-scroll for every
      // message after that.
      bottomRef.current?.scrollIntoView({ behavior: hasScrolledOnceRef.current ? 'smooth' : 'auto' })
      hasScrolledOnceRef.current = true
      return
    }

    const prevCount = prevMessageCountRef.current
    const newCount = messages.length
    prevMessageCountRef.current = newCount
    if (newCount === 0) return

    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false
      const reopened = seenConversationIds.has(conversationId)
      seenConversationIds.add(conversationId)
      if (reopened) {
        // Chat window was closed/minimized and reopened — go straight to the latest message.
        bottomRef.current?.scrollIntoView({ behavior: 'auto' })
        isNearBottomRef.current = true
      } else {
        // Ticket claimed for the first time — open at the top of the history first, then
        // settle on the latest message a moment later.
        scrollContainerRef.current?.scrollTo({ top: 0 })
        isNearBottomRef.current = false
        initialScrollTimeoutRef.current = setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          isNearBottomRef.current = true
        }, INITIAL_TOP_PAUSE_MS)
      }
      return
    }

    if (newCount > prevCount) {
      if (isNearBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      } else {
        setShowNewMessages(true)
      }
    }
  }, [messages.length, conversationId, smartScroll])

  const handleScroll = () => {
    if (!smartScroll) return
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distanceFromBottom < NEAR_BOTTOM_THRESHOLD
    isNearBottomRef.current = nearBottom
    if (nearBottom) setShowNewMessages(false)
  }

  const jumpToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    isNearBottomRef.current = true
    setShowNewMessages(false)
  }

  const sendTyping = (typing) => {
    if (!channelRef.current || !profile) return
    isTypingRef.current = typing
    channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { senderId: profile.id, senderRole: profile.role, typing },
    })
  }

  const handleDraftChange = (e) => {
    setDraft(e.target.value)
    if (readOnly) return
    if (!isTypingRef.current) sendTyping(true)
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current)
    typingIdleTimerRef.current = setTimeout(() => sendTyping(false), TYPING_IDLE_MS)
  }

  useEffect(() => () => {
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current)
  }, [])

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current)
    sendTyping(false)
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!hideHeader && (
        <div className={`flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] ${compact ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Chat</span>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className={`h-full overflow-y-auto ${compact ? 'space-y-2 px-3 py-2.5' : 'space-y-3 px-4 py-4'}`}
        >
          {messages.length === 0 && (
            <p className={`text-center text-sm text-[var(--muted)] ${compact ? 'mt-4' : 'mt-8'}`}>{emptyLabel}</p>
          )}
          {messages.map((m) => {
            const isBot = !!m.is_bot_message
            const mine = isViewerSideMessage(m, isBot, profile?.role, profile?.id)
            const roleKey = isBot ? 'bot' : m.sender_role
            const bubbleClasses = ROLE_BUBBLE[roleKey] ?? ROLE_BUBBLE.customer
            const timeClasses = roleKey === 'customer' ? 'text-[var(--muted)]' : 'text-white/70'
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl text-sm ${compact ? 'px-3 py-1.5 text-[13px]' : 'px-3.5 py-2'} ${bubbleClasses} ${
                  mine ? 'rounded-br-sm' : 'rounded-bl-sm'
                }`}>
                  <div className={`font-semibold uppercase tracking-wide ${compact ? 'mb-0.5 text-[10px]' : 'mb-0.5 text-[11px]'} ${roleKey === 'customer' ? 'text-[var(--muted)]' : 'text-white/80'}`}>
                    {isBot ? 'Ai Bot' : ROLE_LABEL[m.sender_role] ?? m.sender_role}
                  </div>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <div className={`mt-1 font-mono-data ${compact ? 'text-[9px]' : 'text-[10px]'} ${timeClasses}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            )
          })}
          {Object.keys(typingUsers).length > 0 && (
            <div className="flex justify-start">
              <div className={`flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--panel)] text-xs text-[var(--muted)] ${compact ? 'px-3 py-1.5' : 'px-3.5 py-2'}`}>
                <span>
                  {Object.values(typingUsers).map((u) => ROLE_LABEL[u.role] ?? u.role).join(', ')} typing
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] [animation:typing-dot_1.2s_ease-in-out_infinite]" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] [animation:typing-dot_1.2s_ease-in-out_infinite]" style={{ animationDelay: '200ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] [animation:typing-dot_1.2s_ease-in-out_infinite]" style={{ animationDelay: '400ms' }} />
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {smartScroll && showNewMessages && (
          <button
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--brand)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg transition hover:bg-[var(--brand-bright)]"
          >
            ↓ New messages
          </button>
        )}
      </div>

      {error && <p className={`shrink-0 text-xs text-[var(--status-escalated)] ${compact ? 'px-3 pb-1' : 'px-4 pb-1'}`}>{error}</p>}

      {!readOnly && (
        <div className={`flex shrink-0 items-end gap-2 border-t border-[var(--line)] bg-[var(--panel)] ${compact ? 'p-2' : 'p-3'}`}>
          <textarea
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
            rows={1}
            className={`flex-1 resize-none rounded-lg border border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--brand-bright)] focus:outline-none max-h-32 ${
              compact ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2 text-sm'
            }`}
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className={`rounded-lg bg-[var(--brand)] font-semibold text-white disabled:opacity-40 ${
              compact ? 'px-3.5 py-1.5 text-[13px]' : 'px-4 py-2 text-sm'
            }`}
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}

// Which side a bubble renders on depends on the *viewer's group*, not the
// exact sender identity — this keeps alignment stable no matter which
// specific agent/senior agent is looking at the transcript:
//  - Customers viewing their own conversation: their own messages sit on
//    the right; the bot and any staff replies sit on the left.
//  - Agents/senior agents viewing a ticket: ANY agent or senior agent
//    message sits on the right (their "team" side), while the customer and
//    the bot sit on the left — even if a different agent authored it.
//  - Anyone else (e.g. admin) falls back to the old "is this literally my
//    message" behavior.
function isViewerSideMessage(message, isBot, viewerRole, viewerId) {
  if (isBot) return false
  if (viewerRole === 'customer') return message.sender_role === 'customer'
  if (STAFF_ROLES.has(viewerRole)) return STAFF_ROLES.has(message.sender_role)
  return message.sender_id === viewerId
}