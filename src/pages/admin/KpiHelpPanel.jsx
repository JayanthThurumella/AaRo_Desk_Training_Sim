const METRICS = [
  {
    name: 'Total Chats Handled',
    formula: 'Count of tickets assigned to the agent in the selected date range',
    explanation: 'Every ticket the agent claimed, was assigned, or was escalated to during the period, regardless of outcome.',
  },
  {
    name: 'Chats Resolved',
    formula: 'Count of tickets closed with status = Resolved',
    explanation: 'Tickets the agent successfully closed as resolved (not unresolved, cancelled, or abandoned).',
  },
  {
    name: 'First Response Time (FRT, Avg)',
    formula: 'First Agent Reply − Customer Chat Start',
    explanation: 'How long a customer waited in the human queue before receiving the agent\'s first reply, averaged across tickets.',
  },
  {
    name: 'Average Handle Time (AHT)',
    formula: 'Ticket Close Time − Ticket Claim Time (excluding Hold Time)',
    explanation: 'The active working time an agent spent on a ticket, with any time the ticket was on hold subtracted out.',
  },
  {
    name: 'Average Resolution Time',
    formula: 'Ticket Close Time − Ticket Creation Time',
    explanation: 'Total elapsed time from when the ticket entered the queue until it was closed, including any wait or hold time.',
  },
  {
    name: 'SLA Met %',
    formula: 'Tickets completed within SLA ÷ Total Tickets × 100',
    explanation: 'Share of closed tickets where both the response SLA and resolution SLA (set per category) were not breached.',
  },
  {
    name: 'SLA Breached',
    formula: 'Count of closed tickets where response or resolution SLA was exceeded',
    explanation: 'The raw number of tickets that missed their category\'s response or resolution SLA — useful alongside SLA Met % to see volume.',
  },
  {
    name: 'Escalation Rate',
    formula: 'Escalated Tickets ÷ Total Tickets × 100',
    explanation: 'Share of an agent\'s tickets that were escalated to a senior agent, rather than resolved directly.',
  },
  {
    name: 'First Contact Resolution (FCR)',
    formula: 'Tickets resolved without reopening or escalation ÷ Total Resolved × 100',
    explanation: 'Share of resolved tickets that were fixed in a single pass — no reopen, no escalation needed.',
  },
  {
    name: 'Reopened Tickets',
    formula: 'Count of tickets where reopened_count > 0',
    explanation: 'How many of the agent\'s tickets a customer had to reopen after it was closed — a sign the first close didn\'t stick.',
  },
  {
    name: 'Customer Satisfaction (CSAT)',
    formula: 'Average of customer-submitted ratings (1–5) on closed tickets',
    explanation: 'The average post-chat rating customers gave after their ticket was resolved or closed.',
  },
  {
    name: 'Average Customer Wait Time',
    formula: 'Ticket Claim Time − Ticket Queue Entry Time',
    explanation: 'How long a customer sat in the open queue before any agent claimed their ticket (distinct from FRT, which measures time to the first reply after that).',
  },
]

export default function KpiHelpPanel() {
  return (
    <div className="mx-auto max-w-3xl p-4">
      <h2 className="mb-1 text-base font-semibold text-[var(--ink)]">KPI Help</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        What each metric on the reports and overview screens means, and how it's calculated — for training reference.
      </p>

      <div className="space-y-3">
        {METRICS.map((m) => (
          <div key={m.name} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <h3 className="text-sm font-semibold text-[var(--ink)]">{m.name}</h3>
            <p className="mt-1 font-mono-data text-xs text-[var(--brand)]">{m.formula}</p>
            <p className="mt-1.5 text-sm text-[var(--muted)]">{m.explanation}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
