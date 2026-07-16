// Horizontal, icon-free service option "cards" shown inline in the chat right
// after the AI greeting. Kept as its own component (still customer-chat-only)
// so it can be reused wherever the service picker needs to appear.
export default function CategoryPicker({ categories, onSelect, onNotListed, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((c) => (
        <button
          key={c.id}
          disabled={disabled}
          onClick={() => onSelect(c)}
          className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand-bright)] hover:shadow-sm disabled:opacity-40"
        >
          {c.name}
        </button>
      ))}
      <button
        disabled={disabled}
        onClick={onNotListed}
        className="rounded-full border border-dashed border-[var(--line)] bg-[var(--paper)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition-colors hover:border-[var(--brand-bright)] hover:text-[var(--ink)] disabled:opacity-40"
      >
        My issue is not listed
      </button>
    </div>
  )
}