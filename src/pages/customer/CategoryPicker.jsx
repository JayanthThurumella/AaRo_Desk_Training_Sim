const ICONS = {

  'Network / No Signal': '📶',
  'Data / Recharge': '⚡',
  'SIM / Number Porting': '🔀',
  'Device / Technical Support': '⚙️',
}

export default function CategoryPicker({ categories, onSelect, busy }) {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <h2 className="text-2xl font-semibold text-[var(--ink)]">What can we help with?</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Pick the closest match — our assistant will try to sort it out right away.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {categories.map((c) => (
          <button
            key={c.id}
            disabled={busy}
            onClick={() => onSelect(c)}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-6 text-center transition hover:border-[var(--brand-bright)] hover:shadow-md disabled:opacity-50"
          >
            <span className="text-3xl leading-none">{ICONS[c.name] ?? '❓'}</span>
            <span className="text-sm font-medium text-[var(--ink)]">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}