import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import KpiStrip from '../../components/KpiStrip'
import {
  averageHandleTime, averageFirstResponseTime, firstContactResolutionRate,
  escalationRate, reopenRate, abandonmentRate, averageCsat, csatDistribution,
  ticketsByCategory, ticketsByPriority, formatDuration, formatPercent,
} from '../../utils/kpi'

const RANGE_DAYS = { today: 1, week: 7, month: 30 }

export default function OverviewPanel() {
  const [range, setRange] = useState('week')
  const [tickets, setTickets] = useState([])
  const [categories, setCategories] = useState([])
  const [agentCount, setAgentCount] = useState({ available: 0, busy: 0, break: 0, offline: 0 })

  useEffect(() => {
    const since = new Date()
    since.setDate(since.getDate() - RANGE_DAYS[range])

    supabase
      .from('conversations')
      .select('*')
      .gte('created_at', since.toISOString())
      .then(({ data }) => setTickets(data ?? []))

    supabase.from('issue_categories').select('*').then(({ data }) => setCategories(data ?? []))

    supabase
      .from('profiles')
      .select('status')
      .in('role', ['agent', 'senior_agent'])
      .then(({ data }) => {
        const counts = { available: 0, busy: 0, break: 0, offline: 0 }
        ;(data ?? []).forEach((p) => { counts[p.status] = (counts[p.status] ?? 0) + 1 })
        setAgentCount(counts)
      })
  }, [range])

  const closed = tickets.filter((t) => ['resolved', 'unresolved', 'cancelled', 'abandoned'].includes(t.status))
  const csatDist = csatDistribution(closed)
  const byCategory = ticketsByCategory(tickets, categories)
  const byPriority = ticketsByPriority(tickets)

  const kpis = [
    { label: 'Tickets in range', value: tickets.length },
    { label: 'Avg first response', value: formatDuration(averageFirstResponseTime(closed)) },
    { label: 'Avg handle time', value: formatDuration(averageHandleTime(closed)) },
    { label: 'FCR rate', value: formatPercent(firstContactResolutionRate(closed)) },
    { label: 'Escalation rate', value: formatPercent(escalationRate(closed)) },
    { label: 'Reopen rate', value: formatPercent(reopenRate(closed)) },
    { label: 'Abandonment rate', value: formatPercent(abandonmentRate(tickets)) },
    { label: 'Avg CSAT', value: averageCsat(closed) ? `${averageCsat(closed).toFixed(1)}/5` : '—' },
  ]

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--ink)]">Overview</h2>
        <div className="flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5 text-sm">
          {Object.keys(RANGE_DAYS).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 capitalize ${range === r ? 'bg-[var(--brand)] text-white' : 'text-[var(--muted)]'}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <KpiStrip items={kpis} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Team presence right now">
          <div className="grid grid-cols-4 gap-2 text-center">
            <PresenceStat label="Available" value={agentCount.available} color="var(--status-active)" />
            <PresenceStat label="Busy" value={agentCount.busy} color="var(--status-hold)" />
            <PresenceStat label="Break" value={agentCount.break} color="var(--signal)" />
            <PresenceStat label="Offline" value={agentCount.offline} color="var(--status-cancelled)" />
          </div>
        </Card>

        <Card title="CSAT distribution">
          <div className="space-y-1.5">
            {[5, 4, 3, 2, 1].map((n) => {
              const max = Math.max(...Object.values(csatDist), 1)
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-3 font-mono-data text-[var(--muted)]">{n}</span>
                  <div className="h-2.5 flex-1 rounded-full bg-[var(--paper)]">
                    <div
                      className="h-2.5 rounded-full bg-[var(--brand)]"
                      style={{ width: `${(csatDist[n] / max) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono-data text-[var(--muted)]">{csatDist[n]}</span>
                </div>
              )
            })}
          </div>
        </Card>

        <Card title="Tickets by category">
          <ul className="space-y-1.5 text-sm">
            {Object.entries(byCategory).map(([name, count]) => (
              <li key={name} className="flex justify-between">
                <span className="text-[var(--ink)]">{name}</span>
                <span className="font-mono-data text-[var(--muted)]">{count}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Tickets by priority">
          <ul className="space-y-1.5 text-sm">
            {Object.entries(byPriority).map(([name, count]) => (
              <li key={name} className="flex justify-between capitalize">
                <span className="text-[var(--ink)]">{name}</span>
                <span className="font-mono-data text-[var(--muted)]">{count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">{title}</h3>
      {children}
    </div>
  )
}

function PresenceStat({ label, value, color }) {
  return (
    <div>
      <p className="font-mono-data text-lg font-semibold" style={{ color }}>{value}</p>
      <p className="text-[10px] text-[var(--muted)]">{label}</p>
    </div>
  )
}
