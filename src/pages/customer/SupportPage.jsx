import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import BotChat from './BotChat'
import CSATPrompt from './CSATPrompt'
import ConversationSidebar from './ConversationSidebar'
import ChatWindow from '../../components/ChatWindow'
import StatusBadge from '../../components/StatusBadge'
import ConfirmDialog from '../../components/ConfirmDialog'

const TERMINAL = ['resolved', 'unresolved', 'cancelled', 'abandoned']
const QUEUE_COPY = {
  open: "You're in the queue — an agent will join shortly.",
  assigned: 'An agent has picked up your ticket and will say hello shortly.',
  escalated: 'Your ticket has been passed to a specialist for a closer look.',
  pending: "We're waiting to hear back from you.",
  on_hold: 'Your agent has your ticket on hold for a moment.',
}

export default function SupportPage() {
  const { profile, signOut } = useAuth()
  const [categories, setCategories] = useState([])
  const [conversations, setConversations] = useState(undefined) // undefined = loading
  const [selectedId, setSelectedId] = useState(null)
  const [draftMode, setDraftMode] = useState(false)
  const [showCsatFor, setShowCsatFor] = useState(null)
  const [confirmMode, setConfirmMode] = useState(null) // 'newChat' | 'exit' | null
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState(null)

  useEffect(() => {
    supabase.from('issue_categories').select('*').eq('active', true).order('name').then(({ data }) => {
      setCategories(data ?? [])
    })
  }, [])

  const loadConversations = async () => {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('client_id', profile.id)
      .order('created_at', { ascending: false })
    const list = data ?? []
    setConversations(list)
    return list
  }

  useEffect(() => {
    if (!profile?.id) return

    loadConversations().then((list) => {
      const active = list.find((c) => !TERMINAL.includes(c.status))
      if (active) setSelectedId(active.id)
    })

    const channel = supabase
      .channel(`my-conversations-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `client_id=eq.${profile.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setConversations((prev) => {
              const list = prev ?? []
              if (list.some((c) => c.id === payload.new.id)) return list
              return [payload.new, ...list]
            })
          } else if (payload.eventType === 'UPDATE') {
            setConversations((prev) => (prev ?? []).map((c) => (c.id === payload.new.id ? payload.new : c)))
            if (TERMINAL.includes(payload.new.status) && !payload.new.csat_prompted) {
              setShowCsatFor(payload.new)
            }
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  if (conversations === undefined) return null

  const activeConversation = conversations.find((c) => !TERMINAL.includes(c.status)) ?? null
  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null

  // True whenever we're rendering the QueuePanel (agent-side view) rather than
  // the bot script, a fresh draft, or the CSAT prompt — used to widen the
  // sidebar while the customer is queued/with an agent.
  const isQueueView = !draftMode && !showCsatFor && !!selectedConversation && selectedConversation.status !== 'bot'

  // Optimistically merge a conversation returned directly from an RPC call so
  // the UI updates instantly instead of waiting on the realtime round-trip.
  const upsertConversation = (conv) => {
    if (!conv) return
    setConversations((prev) => {
      const list = prev ?? []
      const exists = list.some((c) => c.id === conv.id)
      return exists ? list.map((c) => (c.id === conv.id ? conv : c)) : [conv, ...list]
    })
  }

  const handleTicketStarted = (conv) => {
    upsertConversation(conv)
    setDraftMode(false)
    setSelectedId(conv.id)
  }

  const handleEscalated = (conv) => {
    upsertConversation(conv)
    setDraftMode(false)
    setSelectedId(conv.id)
  }

  const handleResolved = (conv) => {
    upsertConversation(conv)
    setDraftMode(false)
    setSelectedId(conv.id)
    if (conv && !conv.csat_prompted) setShowCsatFor(conv)
  }

  const handleSelectConversation = (conv) => {
    setDraftMode(false)
    setSelectedId(conv.id)
  }

  const openNewChat = () => {
    if (activeConversation) {
      setConfirmError(null)
      setConfirmMode('newChat')
    } else {
      setDraftMode(true)
      setSelectedId(null)
    }
  }

  const requestExit = () => {
    setConfirmError(null)
    setConfirmMode('exit')
  }

  const runExit = async () => {
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      if (activeConversation) {
        const { data, error } = await supabase.rpc('customer_exit_chat', {
          p_conversation_id: activeConversation.id,
        })
        if (error) throw error
        upsertConversation(data)
      }
    } catch (e) {
      setConfirmError(e.message)
      setConfirmBusy(false)
      return false
    }
    setConfirmBusy(false)
    return true
  }

  const confirmNewChat = async () => {
    const ok = await runExit()
    if (!ok) return
    setDraftMode(true)
    setSelectedId(null)
    setConfirmMode(null)
  }

  const confirmExit = async () => {
    const ok = await runExit()
    if (!ok) return
    setDraftMode(false)
    setSelectedId(null)
    setConfirmMode(null)
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--paper)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="signal-bars text-[var(--brand)]"><span></span><span></span><span></span><span></span></span>
          <span className="text-base font-bold text-[var(--ink)]">AaRo Support</span>
        </div>
        <div className="flex items-center gap-4">
          {selectedConversation && <StatusBadge status={selectedConversation.status} />}
          <button onClick={signOut} className="text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <ConversationSidebar
          conversations={conversations}
          categories={categories}
          selectedId={draftMode ? null : selectedId}
          onSelect={handleSelectConversation}
          onNewChat={openNewChat}
          starting={confirmMode === 'newChat' && confirmBusy}
          wide={isQueueView}
        />

        <main className="flex-1 overflow-auto bg-[var(--paper)]">
          <div className="mx-auto h-full w-full max-w-3xl px-4 py-6 md:px-8 md:py-8">
            {showCsatFor ? (
              <CSATPrompt
                conversation={showCsatFor}
                onDone={() => {
                  setShowCsatFor(null)
                }}
              />
            ) : draftMode ? (
              <BotChat
                key="draft"
                conversation={null}
                categories={categories}
                onTicketStarted={handleTicketStarted}
                onResolved={handleResolved}
                onEscalated={handleEscalated}
                onExitRequest={requestExit}
              />
            ) : selectedConversation ? (
              selectedConversation.status === 'bot' ? (
                <BotChat
                  key={selectedConversation.id}
                  conversation={selectedConversation}
                  categories={categories}
                  onTicketStarted={handleTicketStarted}
                  onResolved={handleResolved}
                  onEscalated={handleEscalated}
                  onExitRequest={requestExit}
                />
              ) : (
                <QueuePanel conversation={selectedConversation} onExitRequest={requestExit} />
              )
            ) : (
              <EmptyState onNewChat={openNewChat} />
            )}
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={confirmMode !== null}
        title={confirmMode === 'newChat' ? 'Start a new chat?' : 'Exit this chat?'}
        description={
          confirmMode === 'newChat'
            ? "This will end your current conversation. If an agent has already picked it up, they'll be notified you left."
            : "Are you sure you want to leave? If an agent has already picked up your ticket, they'll be notified you left."
        }
        confirmLabel={confirmMode === 'newChat' ? 'Start new chat' : 'Exit chat'}
        cancelLabel="Stay"
        tone="danger"
        onCancel={() => {
          if (confirmBusy) return
          setConfirmMode(null)
          setConfirmError(null)
        }}
        onConfirm={confirmMode === 'newChat' ? confirmNewChat : confirmExit}
      >
        {confirmError && <p className="mt-2 text-xs text-[var(--status-escalated)]">{confirmError}</p>}
      </ConfirmDialog>
    </div>
  )
}

function QueuePanel({ conversation, onExitRequest }) {
  const isActive = !TERMINAL.includes(conversation.status)
  // Queued but not yet picked up by an agent — show the animated waiting bubble.
  const isWaiting = conversation.status === 'open'

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="text-sm">
          {isActive ? (
            <span className="font-medium text-[var(--brand)]">
              {QUEUE_COPY[conversation.status] ?? 'Your conversation is in progress.'}
            </span>
          ) : (
            <span className="font-medium text-[var(--muted)]">This conversation is closed.</span>
          )}
          <span className="text-[var(--muted)]"> · Ticket {conversation.ticket_number}</span>
        </div>
        {isActive && (
          <button
            onClick={onExitRequest}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition-colors hover:border-[var(--status-escalated)] hover:text-[var(--status-escalated)]"
          >
            Exit Chat
          </button>
        )}
      </div>

      <div className="relative flex-1 overflow-hidden">
        {isWaiting && (
          <div className="pointer-events-none absolute inset-x-0 bottom-15 z-10 px-4 pb-3">
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-sm shadow-md">
                <span className="font-medium text-[var(--ink)]">Waiting for an agent</span>
                <span className="flex items-center gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-[var(--brand)] [animation:typing-dot_1.2s_ease-in-out_infinite]"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-[var(--brand)] [animation:typing-dot_1.2s_ease-in-out_infinite]"
                    style={{ animationDelay: '200ms' }}
                  />
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-[var(--brand)] [animation:typing-dot_1.2s_ease-in-out_infinite]"
                    style={{ animationDelay: '400ms' }}
                  />
                </span>
                <style>{`
                  @keyframes typing-dot {
                    0%, 80%, 100% { opacity: 0.25; }
                    40% { opacity: 1; }
                  }
                `}</style>
              </div>
            </div>
          </div>
        )}
        <ChatWindow
          conversationId={conversation.id}
          readOnly={!isActive}
          emptyLabel={isActive ? "You're through to our support team — say hello!" : 'No messages in this conversation.'}
        />
      </div>
    </div>
  )
}

function EmptyState({ onNewChat }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-base font-medium text-[var(--ink)]">Select a previous conversation, or start a new one.</p>
      <p className="max-w-sm text-sm text-[var(--muted)]">
        Our AI Assistant can sort out most issues right away, and can connect you to a human agent any time.
      </p>
      <button
        onClick={onNewChat}
        className="mt-2 rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-bright)]"
      >
        + New Issue / New Chat
      </button>
    </div>
  )
}