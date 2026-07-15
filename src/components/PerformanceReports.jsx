import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import KpiStrip from './KpiStrip'
import {
  averageHandleTime, averageFirstResponseTime, averageResolutionTime, averageWaitTime,
  firstContactResolutionRate, escalationRate, reopenRate, averageCsat,
  formatDuration, formatPercent, isClosed, slaBreachedCount, slaMetRate,
} from '../utils/kpi'

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

export default function PerformanceReports({ agentId, agentName = 'Agent', role = 'agent' }) {
  const [range, setRange] = useState('today')
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [tickets, setTickets] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('issue_categories').select('*').then(({ data }) => setCategories(data ?? []))
  }, [])

  const bounds = useMemo(() => rangeBounds(range, custom), [range, custom])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  useEffect(() => {
    if (!agentId) return
    setLoading(true)
    supabase
      .from('conversations')
      .select('*')
      .or(`agent_id.eq.${agentId},escalated_to.eq.${agentId}`)
      .gte('created_at', bounds.start.toISOString())
      .lte('created_at', bounds.end.toISOString())
      .then(({ data }) => {
        setTickets(data ?? [])
        setLoading(false)
      })
  }, [agentId, bounds])

  const closed = tickets.filter(isClosed)
  const reopened = tickets.filter(t => (t.reopened_count || 0) > 0)

  const kpis = [
    { label: 'Tickets Claimed', value: tickets.length },
    { label: 'Tickets Resolved', value: closed.filter(t => t.status === 'resolved').length },
    { label: 'Avg Claim Wait', value: formatDuration(averageWaitTime(tickets)) },
    { label: 'Avg First Response', value: formatDuration(averageFirstResponseTime(tickets)) },
    { label: 'Avg Handle Time', value: formatDuration(averageHandleTime(tickets)) },
    { label: 'Avg Resolution Time', value: formatDuration(averageResolutionTime(tickets)) },
    { label: 'SLA Achievement %', value: formatPercent(slaMetRate(tickets, categoryById)) },
    { label: 'SLA Breached', value: slaBreachedCount(tickets, categoryById) },
    { label: 'Escalations', value: tickets.filter(t => t.escalated_to).length },
    { label: 'Transfers', value: tickets.filter(t => t.original_agent_id && t.agent_id !== t.original_agent_id).length }, // approximate
    { label: 'Reopened', value: reopened.length },
    { label: 'CSAT', value: averageCsat(closed) ? `${averageCsat(closed).toFixed(1)}/5` : '—' },
    // QA Score could be fetched separately; we skip for now
  ]

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">{agentName} — Performance Reports</h2>
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
                onChange={(e) => setCustom(c => ({ ...c, start: e.target.value }))}
                className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1"
              />
              <span className="text-[var(--muted)]">to</span>
              <input
                type="date"
                value={custom.end}
                onChange={(e) => setCustom(c => ({ ...c, end: e.target.value }))}
                className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1"
              />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No tickets in the selected range.</p>
      ) : (
        <KpiStrip items={kpis} />
      )}
    </div>
  )
}