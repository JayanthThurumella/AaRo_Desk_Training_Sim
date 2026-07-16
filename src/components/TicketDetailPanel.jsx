import { useState, useEffect } from 'react'
import ChatWindow from './ChatWindow'
import InternalNotes from './InternalNotes'
import TicketActions from './TicketActions'
import QaReviewPanel from './QaReviewPanel'
import StatusBadge, { PriorityBadge } from './StatusBadge'
import { formatDuration, handleTimeSeconds, firstResponseSeconds, waitSeconds, resolutionSeconds, isSlaBreached } from '../utils/kpi'
import { supabase } from '../lib/supabaseClient'

const CLOSED = ['resolved', 'unresolved', 'cancelled', 'abandoned']

export default function TicketDetailPanel({ ticket, category, customer, onChanged, showQaReview = false }) {
  const [tab, setTab] = useState('chat')
  const [extraStats, setExtraStats] = useState({ transfers: 0, escalations: 0, qaScore: null })
  const [showDetails, setShowDetails] = useState(true) // NEW: toggle for details

  useEffect(() => {
    if (!ticket || !CLOSED.includes(ticket.status)) {
      setExtraStats({ transfers: 0, escalations: 0, qaScore: null })
      return
    }
    // Fetch transfer count, escalation count, and QA score for closed tickets
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
          .maybeSingle()
      ])
      setExtraStats({
        transfers: transferCount || 0,
        escalations: escalationCount || 0,
        qaScore: qa?.coaching_score || null
      })
    }
    fetchStats()
  }, [ticket])

  if (!ticket) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
        Select a ticket to view the conversation.
      </div>
    )
  }

  const slaBreached = isSlaBreached(ticket, new Map([[category?.id, category]]))

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* HEADER – now includes a toggle button */}
      <div className="shrink-0 border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono-data text-sm font-semibold text-[var(--ink)]">{ticket.ticket_number}</span>
              <PriorityBadge priority={ticket.priority} />
            </div>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {customer?.full_name ?? 'Customer'} · {category?.name ?? 'Uncategorized'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={ticket.status} />
            {/* Toggle button – only for closed tickets (or always if you prefer) */}
            {CLOSED.includes(ticket.status) && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors p-1"
                aria-label={showDetails ? 'Hide details' : 'Show details'}
              >
                {showDetails ? '▲' : '▼'}
              </button>
            )}
          </div>
        </div>

        {/* Conditionally render stats */}
        {CLOSED.includes(ticket.status) && showDetails && (
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono-data text-[var(--muted)]">
            <span>First Response: {formatDuration(firstResponseSeconds(ticket))}</span>
            <span>Claim Wait: {formatDuration(waitSeconds(ticket))}</span>
            <span>Resolution Time: {formatDuration(resolutionSeconds(ticket))}</span>
            <span>Handle Time: {formatDuration(handleTimeSeconds(ticket))}</span>
            <span>Hold Time: {formatDuration(ticket.hold_total_seconds || 0)}</span>
            <span>Transfers: {extraStats.transfers}</span>
            <span>Escalations: {extraStats.escalations}</span>
            <span>SLA: {slaBreached ? 'Breached' : 'Met'}</span>
            {ticket.csat_score && <span>CSAT: {ticket.csat_score}/5</span>}
            {extraStats.qaScore !== null && <span>QA Score: {extraStats.qaScore}/5</span>}
            {ticket.reopened_count > 0 && <span>Reopened ×{ticket.reopened_count}</span>}
          </div>
        )}
      </div>

      {/* Tabs and content remain unchanged */}
      <div className="flex shrink-0 border-b border-[var(--line)] text-sm font-medium">
        <TabBtn active={tab === 'chat'} onClick={() => setTab('chat')}>Chat</TabBtn>
        <TabBtn active={tab === 'notes'} onClick={() => setTab('notes')}>Internal notes</TabBtn>
        {showQaReview && CLOSED.includes(ticket.status) && (
          <TabBtn active={tab === 'qa'} onClick={() => setTab('qa')}>QA review</TabBtn>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'chat' ? (
          <ChatWindow
            conversationId={ticket.id}
            readOnly={CLOSED.includes(ticket.status)}
            emptyLabel={CLOSED.includes(ticket.status) ? 'No messages were exchanged.' : 'Say hello to get started.'}
          />
        ) : tab === 'notes' ? (
          <InternalNotes conversationId={ticket.id} />
        ) : (
          <QaReviewPanel ticket={ticket} />
        )}
      </div>

      <div className="shrink-0">
        <TicketActions ticket={ticket} onChanged={onChanged} />
      </div>
    </div>
  )
}

function TabBtn({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 border-b-2 -mb-px ${
        active ? 'border-[var(--brand)] text-[var(--ink)]' : 'border-transparent text-[var(--muted)]'
      }`}
    >
      {children}
    </button>
  )
}