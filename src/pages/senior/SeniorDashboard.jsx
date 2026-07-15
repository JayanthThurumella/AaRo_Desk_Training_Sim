import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import PresenceSwitcher from '../../components/PresenceSwitcher'
import NotificationsBell from '../../components/NotificationsBell'
import QueueList from '../../components/QueueList'
import MyTicketsList from '../../components/MyTicketsList'
import TicketDetailPanel from '../../components/TicketDetailPanel'
import TicketHistoryList from '../../components/TicketHistoryList'
import PerformanceReports from '../../components/PerformanceReports'
import KpiStrip from '../../components/KpiStrip'
import StatusBadge, { PriorityBadge } from '../../components/StatusBadge'
import KpiHelpButton from '../../components/KpiHelpButton'
import {
  averageHandleTime, escalationRate, averageCsat, formatDuration, formatPercent, isActiveWork,
} from '../../utils/kpi'

const ACTIVE_STATUSES = ['assigned', 'active', 'on_hold', 'pending']
const CLOSED_STATUSES = ['resolved', 'unresolved', 'cancelled', 'abandoned']

export default function SeniorDashboard() {
  const { profile, signOut } = useAuth()
  const [categories, setCategories] = useState([])
  const [queue, setQueue] = useState([])
  const [escalations, setEscalations] = useState([])
  const [myTickets, setMyTickets] = useState([])
  const [history, setHistory] = useState([])
  const [teamClosedToday, setTeamClosedToday] = useState([])
  const [customers, setCustomers] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [tab, setTab] = useState('escalations')

  const loadAll = useCallback(async () => {
    if (!profile?.id) return
    const [{ data: cats }, { data: q }, { data: esc }, { data: mine }, { data: hist }, { data: closed }] = await Promise.all([
      supabase.from('issue_categories').select('*'),
      supabase.from('conversations').select('*').eq('status', 'open').order('started_at', { ascending: true }),
      supabase.from('conversations').select('*').eq('status', 'escalated').order('started_at', { ascending: true }),
      supabase
        .from('conversations')
        .select('*')
        .or(`agent_id.eq.${profile.id},escalated_to.eq.${profile.id}`)
        .in('status', ACTIVE_STATUSES),
      supabase
        .from('conversations')
        .select('*')
        .or(`agent_id.eq.${profile.id},escalated_to.eq.${profile.id}`)
        .in('status', CLOSED_STATUSES)
        .order('closed_at', { ascending: false })
        .limit(100),
      supabase
        .from('conversations')
        .select('*')
        .in('status', ['resolved', 'unresolved'])
        .gte('closed_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order('closed_at', { ascending: false })
        .limit(200),
    ])
    setCategories(cats ?? [])
    setQueue(q ?? [])
    setEscalations(esc ?? [])
    setMyTickets(mine ?? [])
    setHistory(hist ?? [])
    setTeamClosedToday(closed ?? [])

    const ids = new Set([...(q ?? []), ...(esc ?? []), ...(mine ?? []), ...(hist ?? []), ...(closed ?? [])].map((t) => t.client_id))
    if (ids.size > 0) {
      const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', Array.from(ids))
      setCustomers(Object.fromEntries((people ?? []).map((p) => [p.id, p])))
    }
  }, [profile?.id])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const channel = supabase
      .channel('conversations-senior')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => loadAll())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadAll])

  // Auto‑update presence (same logic as agent)
  useEffect(() => {
    if (!profile) return
    const activeCount = myTickets.filter(t => ACTIVE_STATUSES.includes(t.status)).length
    const max = profile.max_concurrent_tickets || 3
    const currentStatus = profile.status
    if (currentStatus === 'available' && activeCount >= max) {
      supabase.rpc('set_presence', { p_status: 'busy' }).catch(console.error)
    } else if (currentStatus === 'busy' && activeCount < max) {
      supabase.rpc('set_presence', { p_status: 'available' }).catch(console.error)
    }
  }, [myTickets, profile])

  const allVisible = useMemo(
    () => [...queue, ...escalations, ...myTickets, ...history, ...teamClosedToday],
    [queue, escalations, myTickets, history, teamClosedToday]
  )
  const selected = allVisible.find((t) => t.id === selectedId) ?? null
  const category = categories.find((c) => c.id === selected?.category_id)
  const customer = customers[selected?.client_id]

  const kpis = [
    { label: 'Escalations open', value: escalations.length },
    { label: 'Team resolved today', value: teamClosedToday.filter((t) => t.status === 'resolved').length },
    { label: 'Team avg handle time', value: formatDuration(averageHandleTime(teamClosedToday)) },
    { label: 'Escalation rate', value: formatPercent(escalationRate(teamClosedToday)) },
    { label: 'Team avg CSAT', value: averageCsat(teamClosedToday) ? `${averageCsat(teamClosedToday).toFixed(1)}/5` : '—' },
  ]

  return (
    <div className="flex h-screen flex-col bg-[var(--paper)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="signal-bars text-[var(--brand)]"><span></span><span></span><span></span><span></span></span>
          <span className="text-sm font-bold text-[var(--ink)]">Nexline · Senior Desk</span>
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
        <aside className="flex w-72 flex-col border-r border-[var(--line)] bg-[var(--panel)]">
          <div className="flex border-b border-[var(--line)] text-xs font-medium">
            {['escalations', 'queue', 'mine', 'history', 'reports'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 border-b-2 -mb-px capitalize ${
                  tab === t ? 'border-[var(--brand)] text-[var(--ink)]' : 'border-transparent text-[var(--muted)]'
                }`}
              >
                {t === 'mine' ? `Mine (${myTickets.length})` :
                 t === 'queue' ? `Queue (${queue.length})` :
                 t === 'escalations' ? `Escalations (${escalations.length})` :
                 t === 'history' ? `History (${history.length})` :
                 'Reports'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === 'escalations' && (
              <EscalationList
                tickets={escalations}
                categories={categories}
                selectedId={selectedId}
                onSelect={(t) => setSelectedId(t.id)}
              />
            )}
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
                    setSelectedId(id)
                  }}
                  selectedId={selectedId}
                  onSelect={(t) => setSelectedId(t.id)}
                />
              )
            )}
            {tab === 'mine' && (
              <MyTicketsList
                tickets={myTickets}
                categories={categories}
                selectedId={selectedId}
                onSelect={(t) => setSelectedId(t.id)}
              />
            )}
            {tab === 'history' && (
              <TicketHistoryList
                tickets={history}
                categories={categories}
                selectedId={selectedId}
                onSelect={(t) => setSelectedId(t.id)}
              />
            )}
            {tab === 'reports' && (
              <PerformanceReports agentId={profile.id} agentName={profile.full_name} />
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-hidden">
          <TicketDetailPanel
            ticket={selected}
            category={category}
            customer={customer}
            onChanged={loadAll}
            showQaReview
          />
        </main>
      </div>
    </div>
  )
}

function EscalationList({ tickets, categories, selectedId, onSelect }) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  if (tickets.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">No open escalations.</p>
  }
  return (
    <ul className="divide-y divide-[var(--line)]">
      {tickets.map((t) => (
        <li
          key={t.id}
          onClick={() => onSelect(t)}
          className={`cursor-pointer px-4 py-3 hover:bg-[var(--paper)] ${selectedId === t.id ? 'bg-[var(--paper)]' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono-data text-xs text-[var(--muted)]">{t.ticket_number}</span>
            <PriorityBadge priority={t.priority} />
          </div>
          <p className="mt-1 truncate text-sm font-medium text-[var(--ink)]">{categoryById.get(t.category_id)?.name ?? 'Uncategorized'}</p>
          <div className="mt-1.5"><StatusBadge status={t.status} /></div>
        </li>
      ))}
    </ul>
  )
}