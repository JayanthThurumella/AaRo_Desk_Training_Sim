const LABELS = {
  bot: 'With bot',
  open: 'In queue',
  assigned: 'Assigned',
  active: 'Active',
  on_hold: 'On hold',
  escalated: 'Escalated',
  pending: 'Awaiting customer',
  resolved: 'Resolved',
  unresolved: 'Unresolved',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned',
}

const VAR = {
  bot: '--status-bot',
  open: '--status-open',
  assigned: '--status-assigned',
  active: '--status-active',
  on_hold: '--status-hold',
  escalated: '--status-escalated',
  pending: '--status-pending',
  resolved: '--status-resolved',
  unresolved: '--status-unresolved',
  cancelled: '--status-cancelled',
  abandoned: '--status-abandoned',
}

export default function StatusBadge({ status, className = '' }) {
  const color = `var(${VAR[status] ?? '--muted'})`
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${className}`}
      style={{ color, borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {LABELS[status] ?? status}
    </span>
  )
}

export function PriorityBadge({ priority }) {
  const styles = {
    low: 'text-[var(--muted)] border-[var(--line)]',
    medium: 'text-[var(--status-assigned)] border-[var(--status-assigned)]',
    high: 'text-[var(--status-unresolved)] border-[var(--status-unresolved)]',
    urgent: 'text-[var(--status-escalated)] border-[var(--status-escalated)]',
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide border ${styles[priority] ?? ''}`}>
      {priority}
    </span>
  )
}
