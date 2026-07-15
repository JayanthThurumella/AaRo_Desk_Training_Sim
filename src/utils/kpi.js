// KPI utilities — pure functions, no Supabase calls. Every dashboard derives
// its numbers by importing these against ticket/message rows it already has,
// so the definitions can't drift between the agent view, senior view, and
// admin reporting view.

const CLOSED_STATUSES = ['resolved', 'unresolved', 'cancelled', 'abandoned']
const OPEN_QUEUE_STATUSES = ['open']
const ACTIVE_WORK_STATUSES = ['assigned', 'active', 'on_hold', 'escalated', 'pending']

export function isClosed(ticket) {
  return CLOSED_STATUSES.includes(ticket.status)
}

export function isInQueue(ticket) {
  return OPEN_QUEUE_STATUSES.includes(ticket.status)
}

export function isActiveWork(ticket) {
  return ACTIVE_WORK_STATUSES.includes(ticket.status)
}

/** Seconds between queue entry (started_at) and the agent's first reply. */
export function firstResponseSeconds(ticket) {
  if (!ticket.started_at || !ticket.first_response_at) return null
  return diffSeconds(ticket.started_at, ticket.first_response_at)
}

/**
 * Handle time in seconds: wall-clock time in queue+work minus any time spent
 * on hold, minus time before the ticket ever entered the human queue (bot stage
 * doesn't count against a human agent).
 */
export function handleTimeSeconds(ticket) {
  if (!ticket.started_at) return null
  const end = ticket.closed_at ?? new Date().toISOString()
  const total = diffSeconds(ticket.started_at, end)
  return Math.max(total - (ticket.hold_total_seconds ?? 0), 0)
}

/** Resolution time in seconds: queue entry to close. Null while still open. */
export function resolutionSeconds(ticket) {
  if (!ticket.started_at || !ticket.closed_at) return null
  return diffSeconds(ticket.started_at, ticket.closed_at)
}

/** Customer wait time in seconds: queue entry (started_at) until an agent claims the ticket. */
export function waitSeconds(ticket) {
  if (!ticket.started_at || !ticket.claimed_at) return null
  return diffSeconds(ticket.started_at, ticket.claimed_at)
}

export function averageWaitTime(tickets) {
  const times = tickets.map(waitSeconds).filter((v) => v !== null)
  return average(times)
}

export function isResponseSlaBreached(ticket, category) {
  const limitSec = (category?.response_sla_minutes ?? 0) * 60
  if (!limitSec) return false
  const rt = firstResponseSeconds(ticket)
  if (rt !== null) return rt > limitSec
  if (!ticket.started_at || isClosed(ticket)) return false
  return diffSeconds(ticket.started_at, new Date().toISOString()) > limitSec
}

export function isResolutionSlaBreached(ticket, category) {
  const limitSec = (category?.resolution_sla_minutes ?? 0) * 60
  if (!limitSec) return false
  const rt = resolutionSeconds(ticket)
  if (rt !== null) return rt > limitSec
  if (!ticket.started_at || isClosed(ticket)) return false
  return diffSeconds(ticket.started_at, new Date().toISOString()) > limitSec
}

/** True once a queue ticket is within `warnFraction` of breaching response SLA (default 80%). */
export function isSlaAtRisk(ticket, category, warnFraction = 0.8) {
  const limitSec = (category?.response_sla_minutes ?? 0) * 60
  if (!limitSec || !ticket.started_at || ticket.first_response_at) return false
  const elapsed = diffSeconds(ticket.started_at, new Date().toISOString())
  return elapsed > limitSec * warnFraction && elapsed <= limitSec
}

/** True if a ticket breached either its response or resolution SLA. `categoryById` is a Map(category_id -> category row). */
export function isSlaBreached(ticket, categoryById) {
  const category = categoryById.get(ticket.category_id)
  return isResponseSlaBreached(ticket, category) || isResolutionSlaBreached(ticket, category)
}

/** Fraction (0-1) of closed tickets that stayed within SLA. Null when there's nothing closed to measure. */
export function slaMetRate(tickets, categoryById) {
  const closed = tickets.filter(isClosed)
  if (closed.length === 0) return null
  const met = closed.filter((t) => !isSlaBreached(t, categoryById))
  return met.length / closed.length
}

/** Count of closed tickets that breached SLA. */
export function slaBreachedCount(tickets, categoryById) {
  return tickets.filter(isClosed).filter((t) => isSlaBreached(t, categoryById)).length
}

/** Average Handle Time across a set of closed tickets, in seconds. */
export function averageHandleTime(tickets) {
  const times = tickets.filter(isClosed).map(handleTimeSeconds).filter((v) => v !== null)
  return average(times)
}

export function averageFirstResponseTime(tickets) {
  const times = tickets.map(firstResponseSeconds).filter((v) => v !== null)
  return average(times)
}

export function averageResolutionTime(tickets) {
  const times = tickets.filter(isClosed).map(resolutionSeconds).filter((v) => v !== null)
  return average(times)
}

export function firstContactResolutionRate(tickets) {
  const closed = tickets.filter(isClosed)
  if (closed.length === 0) return null
  const fcr = closed.filter((t) => t.close_reason === 'resolved_first_contact' && t.reopened_count === 0)
  return fcr.length / closed.length
}

export function escalationRate(tickets) {
  const humanTickets = tickets.filter((t) => t.source === 'human' || t.started_at)
  if (humanTickets.length === 0) return null
  const escalated = humanTickets.filter((t) => t.escalated_to || t.original_agent_id)
  return escalated.length / humanTickets.length
}

export function reopenRate(tickets) {
  const closed = tickets.filter((t) => (t.reopened_count ?? 0) > 0 || isClosed(t))
  if (closed.length === 0) return null
  const reopened = tickets.filter((t) => (t.reopened_count ?? 0) > 0)
  return reopened.length / closed.length
}

export function abandonmentRate(tickets) {
  const queued = tickets.filter((t) => !!t.started_at)
  if (queued.length === 0) return null
  const abandoned = queued.filter((t) => t.status === 'abandoned')
  return abandoned.length / queued.length
}

export function averageCsat(tickets) {
  const scores = tickets.map((t) => t.csat_score).filter((v) => v !== null && v !== undefined)
  return average(scores)
}

export function csatDistribution(tickets) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  tickets.forEach((t) => {
    if (t.csat_score) dist[t.csat_score] = (dist[t.csat_score] ?? 0) + 1
  })
  return dist
}

/** Agent utilization: fraction of logged-in time spent in 'busy' vs total (busy+available+break). */
export function utilizationRate(timeLogs) {
  const totals = { available: 0, busy: 0, break: 0 }
  timeLogs.forEach((log) => {
    if (!totals[log.status] && log.status !== 'offline') return
    if (log.status === 'offline') return
    const end = log.ended_at ?? new Date().toISOString()
    totals[log.status] = (totals[log.status] ?? 0) + diffSeconds(log.started_at, end)
  })
  const total = totals.available + totals.busy + totals.break
  if (total === 0) return null
  return totals.busy / total
}

/** Auto chat-quality score (0-5) from response cadence + resolution outcome — a coaching aid, not a replacement for QA review. */
export function autoChatQualityScore(ticket, messages) {
  let score = 5
  const rt = firstResponseSeconds(ticket)
  if (rt !== null && rt > 5 * 60) score -= 1
  if (rt !== null && rt > 15 * 60) score -= 1
  if ((ticket.reopened_count ?? 0) > 0) score -= 1
  if (ticket.close_reason === 'unresolved_closed') score -= 1
  const agentMsgs = messages.filter((m) => m.sender_role === 'agent' || m.sender_role === 'senior_agent')
  if (agentMsgs.length > 0) {
    const avgLen = average(agentMsgs.map((m) => m.body.length))
    if (avgLen !== null && avgLen < 15) score -= 0.5
  }
  return Math.max(0, Math.min(5, score))
}

export function ticketsByCategory(tickets, categories) {
  const byId = new Map(categories.map((c) => [c.id, c.name]))
  const counts = {}
  tickets.forEach((t) => {
    const name = byId.get(t.category_id) ?? 'Uncategorized'
    counts[name] = (counts[name] ?? 0) + 1
  })
  return counts
}

export function ticketsByPriority(tickets) {
  const counts = { low: 0, medium: 0, high: 0, urgent: 0 }
  tickets.forEach((t) => {
    if (counts[t.priority] !== undefined) counts[t.priority] += 1
  })
  return counts
}

// ---- formatting helpers ----

export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return '—'
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function formatPercent(fraction) {
  if (fraction === null || fraction === undefined) return '—'
  return `${Math.round(fraction * 1000) / 10}%`
}

function diffSeconds(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 1000
}

function average(nums) {
  if (!nums || nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}
