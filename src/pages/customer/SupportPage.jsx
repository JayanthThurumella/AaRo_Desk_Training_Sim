import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import CategoryPicker from './CategoryPicker'
import BotChat from './BotChat'
import CSATPrompt from './CSATPrompt'
import ChatWindow from '../../components/ChatWindow'
import StatusBadge from '../../components/StatusBadge'

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
  const [conversation, setConversation] = useState(undefined) // undefined = loading, null = none
  const [script, setScript] = useState(null)
  const [starting, setStarting] = useState(false)
  const [showCsatFor, setShowCsatFor] = useState(null)

  useEffect(() => {
    supabase.from('issue_categories').select('*').eq('active', true).order('name').then(({ data }) => {
      setCategories(data ?? [])
    })
  }, [])

  const loadActiveTicket = async () => {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('client_id', profile.id)
      .not('status', 'in', `(${TERMINAL.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setConversation(data ?? null)
  }

  useEffect(() => {
    if (!profile?.id) return
    loadActiveTicket()

    const channel = supabase
      .channel(`my-tickets-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `client_id=eq.${profile.id}` },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setConversation((prev) => (prev && prev.id === payload.new.id ? payload.new : prev))
            if (TERMINAL.includes(payload.new.status) && !payload.new.csat_prompted) {
              setShowCsatFor(payload.new)
            }
          } else if (payload.eventType === 'INSERT') {
            setConversation(payload.new)
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  useEffect(() => {
    if (!conversation?.category_id || conversation.status !== 'bot') {
      setScript(null)
      return
    }
    supabase
      .from('bot_scripts')
      .select('*')
      .eq('category_id', conversation.category_id)
      .single()
      .then(({ data }) => setScript(data ?? null))
  }, [conversation?.category_id, conversation?.status])

  const startTicket = async (category) => {
    setStarting(true)
    const { data, error } = await supabase.rpc('start_or_resume_ticket', { p_category_id: category.id })
    setStarting(false)
    if (!error) setConversation(data)
  }

  if (conversation === undefined) return null

  return (
    <div className="flex h-screen flex-col bg-[var(--paper)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="signal-bars text-[var(--brand)]"><span></span><span></span><span></span><span></span></span>
          <span className="text-base font-bold text-[var(--ink)]">AaRo Support</span>
        </div>
        <div className="flex items-center gap-4">
          {conversation && <StatusBadge status={conversation.status} />}
          <button onClick={signOut} className="text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto bg-[var(--paper)]">
        <div className="mx-auto w-full max-w-5xl px-4 md:px-8 py-6 md:py-10">
          {showCsatFor ? (
            <CSATPrompt conversation={showCsatFor} onDone={() => { setShowCsatFor(null); setConversation(null) }} />
          ) : !conversation ? (
            <CategoryPicker categories={categories} onSelect={startTicket} busy={starting} />
          ) : conversation.status === 'bot' ? (
            <BotChat
              conversation={conversation}
              script={script}
              onResolved={loadActiveTicket}
              onEscalated={loadActiveTicket}
            />
          ) : (
            <div className="flex h-[calc(100vh-8rem)] flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-sm overflow-hidden">
              {QUEUE_COPY[conversation.status] && (
                <div className="border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--brand)_6%,transparent)] px-4 py-3 text-center text-sm font-medium text-[var(--brand)]">
                  {QUEUE_COPY[conversation.status]}
                  {' · '}Ticket {conversation.ticket_number}
                </div>
              )}
              <div className="flex-1 overflow-hidden">
                <ChatWindow
                  conversationId={conversation.id}
                  readOnly={false}
                  emptyLabel="You're through to our support team — say hello!"
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}