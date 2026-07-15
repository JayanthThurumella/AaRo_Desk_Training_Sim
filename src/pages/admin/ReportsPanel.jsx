import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabaseClient'
import KpiStrip from '../../components/KpiStrip'
import {
  averageHandleTime, averageFirstResponseTime, averageResolutionTime, averageWaitTime,
  firstContactResolutionRate, escalationRate, slaMetRate, slaBreachedCount, averageCsat,
  formatDuration, formatPercent, isClosed,
} from '../../utils/kpi'

const RANGES = ['today', 'yesterday', 'last7', 'month', 'custom']
const RANGE_LABEL = { today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 Days', month: 'This Month', custom: 'Custom' }

function rangeBounds(range, custom) {
  const now = new Date()
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

  if (range === 'today') return { start: startOfDay(now), end: now }
  if (range === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    return { start: startOfDay(y), end: startOfDay(now) }
  }
  if (range === 'last7') {
    const s = new Date(now)
    s.setDate(s.getDate() - 7)
    return { start: s, end: now }
  }
  if (range === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
  if (range === 'custom' && custom.start && custom.end) {
    return { start: new Date(custom.start), end: new Date(new Date(custom.end).getTime() + 24 * 60 * 60 * 1000) }
  }
  return { start: startOfDay(now), end: now }
}

export default function ReportsPanel() {
  const [staff, setStaff] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [range, setRange] = useState('today')
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .in('role', ['agent', 'senior_agent'])
      .order('full_name')
      .then(({ data }) => setStaff(data ?? []))
    supabase.from('issue_categories').select('*').then(({ data }) => setCategories(data ?? []))
  }, [])

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const bounds = useMemo(() => rangeBounds(range, custom), [range, custom])

  const loadTickets = useCallback(async () => {
    if (!selectedId) return
    setLoading(true)
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .or(`agent_id.eq.${selectedId},escalated_to.eq.${selectedId}`)
      .gte('created_at', bounds.start.toISOString())
      .lte('created_at', bounds.end.toISOString())
    setTickets(data ?? [])
    setLoading(false)
  }, [selectedId, bounds])

  useEffect(() => { loadTickets() }, [loadTickets])

  const closed = tickets.filter(isClosed)
  const reopened = tickets.filter((t) => (t.reopened_count ?? 0) > 0)
  const selected = staff.find((s) => s.id === selectedId)

  const kpis = [
    { label: 'Total Chats Handled', value: tickets.length },
    { label: 'Chats Resolved', value: closed.filter((t) => t.status === 'resolved').length },
    { label: 'First Response Time (Avg)', value: formatDuration(averageFirstResponseTime(tickets)) },
    { label: 'Average Handle Time (AHT)', value: formatDuration(averageHandleTime(tickets)) },
    { label: 'Average Resolution Time', value: formatDuration(averageResolutionTime(tickets)) },
    { label: 'SLA Met %', value: formatPercent(slaMetRate(tickets, categoryById)) },
    { label: 'SLA Breached', value: slaBreachedCount(tickets, categoryById) },
    { label: 'Escalation Rate', value: formatPercent(escalationRate(tickets)) },
    { label: 'First Contact Resolution (FCR)', value: formatPercent(firstContactResolutionRate(tickets)) },
    { label: 'Reopened Tickets', value: reopened.length },
    { label: 'Customer Satisfaction (CSAT)', value: averageCsat(closed) ? `${averageCsat(closed).toFixed(1)}/5` : '—' },
    { label: 'Average Customer Wait Time', value: formatDuration(averageWaitTime(tickets)) },
  ]

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-64 shrink-0 border-r border-[var(--line)] bg-[var(--panel)] overflow-y-auto">
        <h2 className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold text-[var(--ink)]">Agents & senior agents</h2>
        <ul className="divide-y divide-[var(--line)]">
          {staff.map((s) => (
            <li
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`cursor-pointer px-4 py-3 hover:bg-[var(--paper)] ${selectedId === s.id ? 'bg-[var(--paper)]' : ''}`}
            >
              <p className="text-sm font-medium text-[var(--ink)]">{s.full_name}</p>
              <p className="text-[11px] capitalize text-[var(--muted)]">{s.role.replace('_', ' ')}</p>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex-1 overflow-y-auto p-4">
        {!selected ? (
          <p className="mt-12 text-center text-sm text-[var(--muted)]">Select an agent or senior agent to view their KPI report.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--ink)]">{selected.full_name}</h2>
                <p className="text-sm capitalize text-[var(--muted)]">{selected.role.replace('_', ' ')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5 text-sm">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={`rounded-md px-3 py-1 ${range === r ? 'bg-[var(--brand)] text-white' : 'text-[var(--muted)]'}`}
                    >
                      {RANGE_LABEL[r]}
                    </button>
                  ))}
                </div>
                {range === 'custom' && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <input
                      type="date"
                      value={custom.start}
                      onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                      className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1"
                    />
                    <span className="text-[var(--muted)]">to</span>
                    <input
                      type="date"
                      value={custom.end}
                      onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                      className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1"
                    />
                  </div>
                )}
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-[var(--muted)]">Loading…</p>
            ) : tickets.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No tickets for this agent in the selected range.</p>
            ) : (
              <KpiStrip items={kpis} />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
