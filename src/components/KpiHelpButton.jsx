import { useState } from 'react'

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

export default function KpiHelpButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2 hover:border-[var(--brand-bright)]"
        aria-label="KPI Help"
        title="KPI definitions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-[var(--ink)]/40" onClick={() => setOpen(false)} />
          <div className="fixed inset-4 z-50 overflow-y-auto rounded-xl bg-[var(--panel)] border border-[var(--line)] p-6 shadow-xl max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[var(--ink)]">KPI Help</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 hover:bg-[var(--paper)] text-[var(--muted)]"
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p className="mb-4 text-sm text-[var(--muted)]">
              What each metric on the reports and overview screens means, and how it's calculated — for training reference.
            </p>
            <div className="space-y-3">
              {METRICS.map((m) => (
                <div key={m.name} className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4">
                  <h3 className="text-sm font-semibold text-[var(--ink)]">{m.name}</h3>
                  <p className="mt-1 font-mono-data text-xs text-[var(--brand)]">{m.formula}</p>
                  <p className="mt-1.5 text-sm text-[var(--muted)]">{m.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}