export default function KpiStrip({ items }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="bg-[var(--panel)] px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{it.label}</p>
          <p className="mt-1 font-mono-data text-lg font-semibold text-[var(--ink)]">{it.value}</p>
        </div>
      ))}
    </div>
  )
}
