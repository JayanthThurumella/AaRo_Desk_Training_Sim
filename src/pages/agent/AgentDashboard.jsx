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
import KpiHelpButton from '../../components/KpiHelpButton'
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
  const [closedToday, setClosedToday] = useState([])
  const [customers, setCustomers] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [tab, setTab] = useState('queue')
  const [statusUpdated, setStatusUpdated] = useState(false)

  const loadAll = useCallback(async () => {
    if (!profile?.id) return
    const [{ data: cats }, { data: q }, { data: mine }, { data: hist }, { data: closed }] = await Promise.all([
      supabase.from('issue_categories').select('*'),
      supabase.from('conversations').select('*').eq('status', 'open').order('started_at', { ascending: true }),
      supabase.from('conversations').select('*').eq('agent_id', profile.id).in('status', ACTIVE_STATUSES),
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
    setHistory(hist ?? [])
    setClosedToday(closed ?? [])

    const ids = new Set([...(q ?? []), ...(mine ?? []), ...(hist ?? []), ...(closed ?? [])].map((t) => t.client_id))
    if (ids.size > 0) {
      const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', Array.from(ids))
      setCustomers(Object.fromEntries((people ?? []).map((p) => [p.id, p])))
    }
  }, [profile?.id])

  useEffect(() => { loadAll() }, [loadAll])

  // Realtime subscription for conversations
  useEffect(() => {
    const channel = supabase
      .channel('conversations-agent')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => loadAll())
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
      supabase.rpc('set_presence', { p_status: newStatus }).catch(console.error)
    }
  }, [myTickets, profile])

  const selected = useMemo(
    () => [...queue, ...myTickets, ...history, ...closedToday].find((t) => t.id === selectedId) ?? null,
    [queue, myTickets, history, closedToday, selectedId]
  )
  const category = categories.find((c) => c.id === selected?.category_id)
  const customer = customers[selected?.client_id]

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
        <aside className="flex w-100 flex-col border-r border-[var(--line)] bg-[var(--panel)]">
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
                 t === 'history' ? `History (${history.length})` :
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
                    setSelectedId(id)  // auto‑open the claimed ticket
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
          <TicketDetailPanel ticket={selected} category={category} customer={customer} onChanged={loadAll} />
        </main>
      </div>
    </div>
  )
}