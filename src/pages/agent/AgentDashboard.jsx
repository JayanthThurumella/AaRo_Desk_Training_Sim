import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import PresenceSwitcher from '../../components/PresenceSwitcher'
import NotificationsBell from '../../components/NotificationsBell'
import QueueList from '../../components/QueueList'
import MyTicketsList from '../../components/MyTicketsList'
import TicketHistoryList from '../../components/TicketHistoryList'
import PerformanceReports from '../../components/PerformanceReports'
import KpiStrip from '../../components/KpiStrip'
import KpiHelpButton from '../../components/KpiHelpButton'
import ChatWorkspace from '../../components/ChatWorkspace'
import useChatWindows from '../../hooks/useChatWindows'
import {
  averageHandleTime, averageFirstResponseTime, firstContactResolutionRate,
  averageCsat, formatDuration, formatPercent, isActiveWork,
} from '../../utils/kpi'

const ACTIVE_STATUSES = ['assigned', 'active', 'on_hold', 'escalated', 'pending']
const CLOSED_STATUSES = ['resolved', 'unresolved', 'cancelled', 'abandoned']

export default function AgentDashboard() {
  const { profile, signOut } = useAuth()
  const [categories, setCategories] = useState([])
  const [queue, setQueue] = useState([])
  const [myTickets, setMyTickets] = useState([])
  const [history, setHistory] = useState([])
  // Escalation ownership: tickets this agent originally owned but whose
  // senior-agent claim (take_ownership) has fully taken over — agent_id is
  // still this agent for record-keeping, but escalated_to now points to a
  // different (senior) agent. These are read-only for this agent and shown
  // under History, not under active "mine" tickets.
  const [handedOff, setHandedOff] = useState([])
  const [closedToday, setClosedToday] = useState([])
  const [customers, setCustomers] = useState({})
  const [tab, setTab] = useState('queue')
  const [statusUpdated, setStatusUpdated] = useState(false)
  // New-message-arrived indicator per conversation id, shown as a badge in
  // the sidebar lists while a ticket isn't currently open in a visible
  // (non-minimized) window.
  const [unreadIds, setUnreadIds] = useState(() => new Set())
  const {
    openIds, minimizedIds, activeId,
    openWindow, closeWindow, focusWindow, toggleMinimize, getCascadeIndex,
  } = useChatWindows()
  const visibleIdsRef = useRef(new Set())
  useEffect(() => {
    visibleIdsRef.current = new Set(openIds.filter((id) => !minimizedIds.has(id)))
  }, [openIds, minimizedIds])

  const clearUnread = useCallback((id) => {
    setUnreadIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const loadAll = useCallback(async () => {
    if (!profile?.id) return
    const [{ data: cats }, { data: q }, { data: mine }, { data: handed }, { data: hist }, { data: closed }] = await Promise.all([
      supabase.from('issue_categories').select('*'),
      supabase.from('conversations').select('*').eq('status', 'open').order('started_at', { ascending: true }),
      supabase
        .from('conversations')
        .select('*')
        .eq('agent_id', profile.id)
        .in('status', ACTIVE_STATUSES)
        .or(`escalated_to.is.null,escalated_to.eq.${profile.id}`),
      supabase
        .from('conversations')
        .select('*')
        .eq('agent_id', profile.id)
        .not('escalated_to', 'is', null)
        .neq('escalated_to', profile.id)
        .order('updated_at', { ascending: false }),
      supabase.from('conversations').select('*').eq('agent_id', profile.id).in('status', CLOSED_STATUSES).order('closed_at', { ascending: false }).limit(100),
      supabase
        .from('conversations')
        .select('*')
        .eq('agent_id', profile.id)
        .in('status', ['resolved', 'unresolved'])
        .gte('closed_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    ])
    setCategories(cats ?? [])
    setQueue(q ?? [])
    setMyTickets(mine ?? [])
    setHandedOff(handed ?? [])
    setHistory(hist ?? [])
    setClosedToday(closed ?? [])

    const ids = new Set([...(q ?? []), ...(mine ?? []), ...(handed ?? []), ...(hist ?? []), ...(closed ?? [])].map((t) => t.client_id))
    if (ids.size > 0) {
      const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', Array.from(ids))
      setCustomers(Object.fromEntries((people ?? []).map((p) => [p.id, p])))
    }
  }, [profile?.id])

  useEffect(() => { loadAll() }, [loadAll])

  // Unread badge: any new message on a ticket that isn't the one currently
  // open marks that ticket unread in the sidebar, until the agent selects it.
  // Uses the 'ticket-messages' broadcast (not postgres_changes on `messages`)
  // because messages_select is a cross-table EXISTS(...conversations...)
  // check, which Realtime doesn't reliably evaluate for postgres_changes —
  // see supabase/9_message_broadcast.sql for the full explanation (same
  // class of issue as the open-queue broadcast in file 5).
  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase
      .channel('ticket-messages', { config: { private: false } })
      .on('broadcast', { event: 'new_message' }, (payload) => {
        const m = payload.payload
        if (m.sender_id === profile.id) return
        if (visibleIdsRef.current.has(m.conversation_id)) return
        setUnreadIds((prev) => {
          if (prev.has(m.conversation_id)) return prev
          const next = new Set(prev)
          next.add(m.conversation_id)
          return next
        })
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.id])

  // Realtime subscription for conversations
  useEffect(() => {
    const channel = supabase
      .channel('conversations-agent')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => loadAll())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadAll])

  // Open-queue broadcast: a ticket entering/leaving the shared queue (claimed,
  // rejected back, newly escalated to open, etc.) is pushed to every agent
  // instantly via Realtime Broadcast — this is what makes a claim by another
  // agent disappear from this queue live, no hard refresh needed. See
  // supabase/5_realtime_queue_broadcast.sql for why postgres_changes alone
  // isn't enough here (RLS hides the row from other agents the instant it's
  // claimed, so they never get that postgres_changes event).
  useEffect(() => {
    const channel = supabase
      .channel('agent-queue', { config: { private: false } })
      .on('broadcast', { event: 'queue_change' }, () => loadAll())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadAll])

  // Auto‑update agent availability based on active ticket count
  useEffect(() => {
    if (!profile) return
    const activeCount = myTickets.filter(t => ACTIVE_STATUSES.includes(t.status)).length
    const max = profile.max_concurrent_tickets || 3
    const currentStatus = profile.status

    const shouldSetBusy = currentStatus === 'available' && activeCount >= max
    const shouldSetAvailable = currentStatus === 'busy' && activeCount < max

    if (shouldSetBusy || shouldSetAvailable) {
      const newStatus = shouldSetBusy ? 'busy' : 'available'
      supabase.rpc('set_presence', { p_status: newStatus }).then(({ error }) => {
        if (error) console.error(error)
      })
    }
  }, [myTickets, profile])

  // History tab shows both truly-closed tickets and tickets handed off
  // completely to a senior agent after escalation (§ Escalation Ownership).
  const historyTickets = useMemo(
    () => [...history, ...handedOff].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    [history, handedOff]
  )

  const ticketsById = useMemo(() => {
    const map = new Map()
    for (const t of [...queue, ...myTickets, ...historyTickets, ...closedToday]) map.set(t.id, t)
    return map
  }, [queue, myTickets, historyTickets, closedToday])
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const customersById = useMemo(() => new Map(Object.entries(customers)), [customers])

  const kpis = [
    { label: 'Open now', value: myTickets.filter(isActiveWork).length },
    { label: 'Resolved today', value: closedToday.filter((t) => t.status === 'resolved').length },
    { label: 'Avg first response', value: formatDuration(averageFirstResponseTime(closedToday)) },
    { label: 'Avg handle time', value: formatDuration(averageHandleTime(closedToday)) },
    { label: 'FCR rate', value: formatPercent(firstContactResolutionRate(closedToday)) },
    { label: 'Avg CSAT', value: averageCsat(closedToday) ? `${averageCsat(closedToday).toFixed(1)}/5` : '—' },
  ]

  return (
    <div className="flex h-screen flex-col bg-[var(--paper)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="signal-bars text-[var(--brand)]"><span></span><span></span><span></span><span></span></span>
          <span className="text-sm font-bold text-[var(--ink)]">AaRo Desk · Agent</span>
        </div>
        <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--muted)]">{profile.full_name}</span>
            <PresenceSwitcher />
            <NotificationsBell />
            <KpiHelpButton />
            <button onClick={signOut} className="text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]">
              Sign out
            </button>
          </div>
      </header>

      <div className="border-b border-[var(--line)] bg-[var(--panel)] px-4 py-3">
        <KpiStrip items={kpis} />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-120 flex-col border-r border-[var(--line)] bg-[var(--panel)]">
          <div className="flex border-b border-[var(--line)] text-sm font-medium">
            {['queue', 'mine', 'history', 'reports'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 border-b-2 -mb-px capitalize ${
                  tab === t ? 'border-[var(--brand)] text-[var(--ink)]' : 'border-transparent text-[var(--muted)]'
                }`}
              >
                {t === 'mine' ? `My tickets (${myTickets.length})` :
                 t === 'queue' ? `Queue (${queue.length})` :
                 t === 'history' ? `History (${historyTickets.length})` :
                 'Reports'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === 'queue' && (
              profile.status !== 'available' ? (
                <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">
                  Set your status to <strong>Available</strong> to see and claim queued tickets.
                </p>
              ) : (
                <QueueList
                  tickets={queue}
                  categories={categories}
                  canClaim
                  onClaimed={(id) => {
                    loadAll()
                    openWindow(id)  // auto‑open the claimed ticket in its own window
                    clearUnread(id)
                  }}
                  selectedId={activeId}
                  onSelect={(t) => { openWindow(t.id); clearUnread(t.id) }}
                />
              )
            )}
            {tab === 'mine' && (
              <MyTicketsList
                tickets={myTickets}
                categories={categories}
                selectedId={activeId}
                unreadIds={unreadIds}
                onSelect={(t) => { openWindow(t.id); clearUnread(t.id) }}
              />
            )}
            {tab === 'history' && (
              <TicketHistoryList
                tickets={historyTickets}
                categories={categories}
                selectedId={activeId}
                onSelect={(t) => { openWindow(t.id); clearUnread(t.id) }}
              />
            )}
            {tab === 'reports' && (
              <PerformanceReports agentId={profile.id} agentName={profile.full_name} />
            )}
          </div>
        </aside>

        <ChatWorkspace
          ticketsById={ticketsById}
          categoriesById={categoriesById}
          customersById={customersById}
          openIds={openIds}
          minimizedIds={minimizedIds}
          activeId={activeId}
          getCascadeIndex={getCascadeIndex}
          onFocus={focusWindow}
          onClose={closeWindow}
          onMinimize={toggleMinimize}
          onChanged={loadAll}
        />
      </div>
    </div>
  )
}