const ICONS = {
  Billing: '₹',
  'Network / No Signal': '📶',
  'Data / Recharge': '⚡',
  'SIM / Number Porting': '🔀',
  'Device / Technical Support': '⚙️',
}

export default function CategoryPicker({ categories, onSelect, busy }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h2 className="text-lg font-semibold text-[var(--ink)]">What can we help with?</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Pick the closest match — our assistant will try to sort it out right away.</p>

      <div className="mt-6 space-y-2">
        {categories.map((c) => (
          <button
            key={c.id}
            disabled={busy}
            onClick={() => onSelect(c)}
            className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3.5 text-left transition hover:border-[var(--brand-bright)] disabled:opacity-50"
          >
            <span className="text-xl leading-none">{ICONS[c.name] ?? '❓'}</span>
            <span className="text-sm font-medium text-[var(--ink)]">{c.name}</span>
            <svg className="ml-auto text-[var(--muted)]" width="16" height="16" viewBox="0 0 16 16">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}
