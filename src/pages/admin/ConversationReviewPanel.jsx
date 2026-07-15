import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ChatWindow from '../../components/ChatWindow'
import InternalNotes from '../../components/InternalNotes'
import QaReviewPanel from '../../components/QaReviewPanel'
import StatusBadge, { PriorityBadge } from '../../components/StatusBadge'
import { formatDuration, handleTimeSeconds, resolutionSeconds } from '../../utils/kpi'

const CLOSED_STATUSES = ['resolved', 'unresolved', 'cancelled', 'abandoned']
const STATUS_FILTERS = ['all', 'resolved', 'unresolved', 'cancelled', 'abandoned']

// Admin reviews completed conversations for coaching purposes only — no live
// monitoring, no join, no ticket actions. The chat/notes are shown read-only
// and the only thing admin can do here is leave a QA coaching review.
export default function ConversationReviewPanel() {
  const [tickets, setTickets] = useState([])
  const [categories, setCategories] = useState([])
  const [people, setPeople] = useState({}) // id -> full_name (customers + agents)
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const load = useCallback(async () => {
    const [{ data: convos }, { data: cats }] = await Promise.all([
      supabase
        .from('conversations')
        .select('*')
        .in('status', CLOSED_STATUSES)
        .order('closed_at', { ascending: false })
        .limit(300),
      supabase.from('issue_categories').select('*'),
    ])
    setTickets(convos ?? [])
    setCategories(cats ?? [])

    const ids = new Set()
    ;(convos ?? []).forEach((t) => {
      if (t.client_id) ids.add(t.client_id)
      if (t.agent_id) ids.add(t.agent_id)
      if (t.escalated_to) ids.add(t.escalated_to)
    })
    if (ids.size > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', Array.from(ids))
      setPeople(Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name])))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const visible = tickets.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (categoryFilter !== 'all' && t.category_id !== categoryFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const agentName = (people[t.agent_id] ?? '').toLowerCase()
      const customerName = (people[t.client_id] ?? '').toLowerCase()
      if (!t.ticket_number.toLowerCase().includes(q) && !agentName.includes(q) && !customerName.includes(q)) {
        return false
      }
    }
    return true
  })

  const selected = tickets.find((t) => t.id === selectedId) ?? null

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-80 flex-col border-r border-[var(--line)] bg-[var(--panel)]">
        <div className="border-b border-[var(--line)] p-3 space-y-2">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Completed conversations</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket # or name…"
            className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize ${
                  statusFilter === s ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--line)] text-[var(--muted)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-xs"
          >
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">No completed conversations match.</p>
          )}
          <ul className="divide-y divide-[var(--line)]">
            {visible.map((t) => (
              <li
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`cursor-pointer px-4 py-3 hover:bg-[var(--paper)] ${selectedId === t.id ? 'bg-[var(--paper)]' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-data text-xs text-[var(--muted)]">{t.ticket_number}</span>
                  <PriorityBadge priority={t.priority} />
                </div>
                <p className="mt-1 truncate text-sm font-medium text-[var(--ink)]">
                  {categoryById.get(t.category_id)?.name ?? 'Uncategorized'}
                </p>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  Agent: {people[t.agent_id] ?? people[t.escalated_to] ?? '—'}
                </p>
                <div className="mt-1.5"><StatusBadge status={t.status} /></div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        <ReviewDetail
          ticket={selected}
          category={categoryById.get(selected?.category_id)}
          customerName={people[selected?.client_id]}
          agentName={people[selected?.agent_id] ?? people[selected?.escalated_to]}
        />
      </main>
    </div>
  )
}

function ReviewDetail({ ticket, category, customerName, agentName }) {
  const [tab, setTab] = useState('chat')

  useEffect(() => { setTab('chat') }, [ticket?.id])

  if (!ticket) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
        Select a completed conversation to review it and leave coaching feedback.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono-data text-sm font-semibold text-[var(--ink)]">{ticket.ticket_number}</span>
              <PriorityBadge priority={ticket.priority} />
            </div>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {customerName ?? 'Customer'} · {category?.name ?? 'Uncategorized'} · Handled by {agentName ?? '—'}
            </p>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[11px] font-mono-data text-[var(--muted)]">
          <span>Handle time: {formatDuration(handleTimeSeconds(ticket))}</span>
          <span>Resolution time: {formatDuration(resolutionSeconds(ticket))}</span>
          {ticket.reopened_count > 0 && <span>Reopened ×{ticket.reopened_count}</span>}
          {ticket.csat_score && <span>CSAT: {ticket.csat_score}/5</span>}
          {ticket.close_reason && <span className="capitalize">{ticket.close_reason.replaceAll('_', ' ')}</span>}
        </div>
      </div>

      <div className="flex border-b border-[var(--line)] text-sm font-medium">
        <TabBtn active={tab === 'chat'} onClick={() => setTab('chat')}>Chat</TabBtn>
        <TabBtn active={tab === 'notes'} onClick={() => setTab('notes')}>Internal notes</TabBtn>
        <TabBtn active={tab === 'qa'} onClick={() => setTab('qa')}>Coaching / QA review</TabBtn>
      </div>

      <div className="flex-1 overflow-hidden overflow-y-auto">
        {tab === 'chat' ? (
          <ChatWindow conversationId={ticket.id} readOnly emptyLabel="No messages were exchanged." />
        ) : tab === 'notes' ? (
          <InternalNotes conversationId={ticket.id} readOnly />
        ) : (
          <QaReviewPanel ticket={ticket} />
        )}
      </div>

      <p className="border-t border-[var(--line)] px-4 py-2 text-center text-[11px] text-[var(--muted)]">
        Review only — admin cannot join or act on live chats. This conversation is closed.
      </p>
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
