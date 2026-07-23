import { useState, useEffect } from 'react'
import ChatWindow from './ChatWindow'
import InternalNotes from './InternalNotes'
import TicketActions from './TicketActions'
import QaReviewPanel from './QaReviewPanel'
import PreviousChatPanel from './PreviousChatPanel'
import StatusBadge, { PriorityBadge } from './StatusBadge'
import { formatDuration, viewerHandleTimeSeconds, firstResponseSeconds, waitSeconds, resolutionSeconds, isSlaBreached } from '../utils/kpi'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

const CLOSED = ['resolved', 'unresolved', 'cancelled', 'abandoned']

/**
 * The entire working surface for one ticket: header/stat strip, chat /
 * internal notes / QA tabs, and the ticket action bar — everything an
 * agent needs for this ticket, self-contained so it can be dropped
 * straight into a <FloatingChatWindow/>. One of these is mounted per open
 * window, so all state here is scoped to that single ticket only.
 */
export default function TicketWindow({ ticket, category, onChanged, showQaReview = false }) {
  const { profile } = useAuth()
  const [tab, setTab] = useState('chat')
  const [extraStats, setExtraStats] = useState({ transfers: 0, escalations: 0, qaScore: null })
  const [showDetails, setShowDetails] = useState(false)
  // Most recent escalation row for this ticket ({ created_at, resolved_at, to_agent_id }),
  // used to split handle time between the agent and the senior agent independently
  // (see viewerHandleTimeSeconds in utils/kpi.js) instead of showing one combined figure.
  const [latestEscalation, setLatestEscalation] = useState(null)

  useEffect(() => {
    if (!ticket || !CLOSED.includes(ticket.status)) {
      setExtraStats({ transfers: 0, escalations: 0, qaScore: null })
      return
    }
    let cancelled = false
    const fetchStats = async () => {
      const [{ count: transferCount }, { count: escalationCount }, { data: qa }] = await Promise.all([
        supabase.from('transfers').select('*', { count: 'exact', head: true }).eq('conversation_id', ticket.id),
        supabase.from('escalations').select('*', { count: 'exact', head: true }).eq('conversation_id', ticket.id),
        supabase
          .from('qa_reviews')
          .select('coaching_score')
          .eq('conversation_id', ticket.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (cancelled) return
      setExtraStats({
        transfers: transferCount || 0,
        escalations: escalationCount || 0,
        qaScore: qa?.coaching_score || null,
      })
    }
    fetchStats()
    return () => { cancelled = true }
  }, [ticket])

  useEffect(() => {
    if (!ticket?.id || !ticket.original_agent_id) {
      setLatestEscalation(null)
      return
    }
    let cancelled = false
    supabase
      .from('escalations')
      .select('created_at, resolved_at, to_agent_id')
      .eq('conversation_id', ticket.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setLatestEscalation(data ?? null) })
    return () => { cancelled = true }
  }, [ticket?.id, ticket?.original_agent_id])

  if (!ticket) return null

  const slaBreached = isSlaBreached(ticket, new Map([[category?.id, category]]))
  // Only tickets created via the customer's "reopen" flow (a brand-new
  // conversation linked back to the one it replaced) have a previous
  // conversation to show — see reopen_ticket_new_session in
  // supabase/8_enhancements.sql.
  const hasPreviousChat = !!ticket.parent_conversation_id

  // Escalation ownership: once a senior agent has claimed this ticket
  // (escalated_to set to someone other than the original agent), the
  // original agent's copy becomes fully read-only — chat input disabled,
  // no ticket actions — ownership has moved entirely to the senior agent.
  const isHandedOff = !!(
    ticket.escalated_to &&
    ticket.escalated_to !== profile.id &&
    ticket.agent_id === profile.id &&
    profile.role === 'agent'
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--line)] px-2.5 py-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <PriorityBadge priority={ticket.priority} />
            <span className="truncate text-xs text-[var(--muted)]">{category?.name ?? 'Uncategorized'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={ticket.status} />
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="p-1 text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
              aria-label={showDetails ? 'Hide details' : 'Show details'}
              title={showDetails ? 'Hide details' : 'Show details'}
            >
              {showDetails ? '▲' : '▼'}
            </button>
          </div>
        </div>

        {showDetails && (
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono-data text-[var(--muted)]">
            <span>First Response: {formatDuration(firstResponseSeconds(ticket))}</span>
            <span>Claim Wait: {formatDuration(waitSeconds(ticket))}</span>
            {CLOSED.includes(ticket.status) && (
              <>
                <span>Resolution Time: {formatDuration(resolutionSeconds(ticket))}</span>
                <span>
                  {profile.role === 'senior_agent' ? 'Senior Handle Time' : 'Agent Handle Time'}: {formatDuration(viewerHandleTimeSeconds(ticket, profile.id, latestEscalation))}
                </span>
                <span>Hold Time: {formatDuration(ticket.hold_total_seconds || 0)}</span>
                <span>Transfers: {extraStats.transfers}</span>
                <span>Escalations: {extraStats.escalations}</span>
                <span>SLA: {slaBreached ? 'Breached' : 'Met'}</span>
                {ticket.csat_score && <span>CSAT: {ticket.csat_score}/5</span>}
                {extraStats.qaScore !== null && <span>QA Score: {extraStats.qaScore}/5</span>}
                {ticket.reopened_count > 0 && <span>Reopened ×{ticket.reopened_count}</span>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 border-b border-[var(--line)] text-xs font-medium">
        <TabBtn active={tab === 'chat'} onClick={() => setTab('chat')}>Chat</TabBtn>
        <TabBtn active={tab === 'notes'} onClick={() => setTab('notes')}>Notes</TabBtn>
        {hasPreviousChat && (
          <TabBtn active={tab === 'previous'} onClick={() => setTab('previous')}>Previous Chat</TabBtn>
        )}
        {showQaReview && CLOSED.includes(ticket.status) && (
          <TabBtn active={tab === 'qa'} onClick={() => setTab('qa')}>QA</TabBtn>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tab === 'chat' ? (
          <ChatWindow
            conversationId={ticket.id}
            readOnly={CLOSED.includes(ticket.status) || isHandedOff}
            emptyLabel={CLOSED.includes(ticket.status) ? 'No messages were exchanged.' : 'Say hello to get started.'}
            hideHeader
            compact
            smartScroll
          />
        ) : tab === 'notes' ? (
          <InternalNotes conversationId={ticket.id} />
        ) : tab === 'previous' ? (
          <PreviousChatPanel conversationId={ticket.parent_conversation_id} />
        ) : (
          <QaReviewPanel ticket={ticket} />
        )}
      </div>

      {!isHandedOff && (
        <div className="shrink-0">
          <TicketActions ticket={ticket} onChanged={onChanged} />
        </div>
      )}
    </div>
  )
}

function TabBtn({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 border-b-2 -mb-px ${
        active ? 'border-[var(--brand)] text-[var(--ink)]' : 'border-transparent text-[var(--muted)]'
      }`}
    >
      {children}
    </button>
  )
}