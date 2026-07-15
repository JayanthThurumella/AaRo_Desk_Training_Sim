import { useState } from 'react'

/**
 * Confirmation dialog that optionally requires a reason (used for escalate/transfer/close,
 * per the spec's requirement that every consequential action be logged with a reason).
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  requireReason = false,
  tone = 'default', // 'default' | 'danger'
  onConfirm,
  onCancel,
  children,
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const canSubmit = !requireReason || reason.trim().length > 0

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      await onConfirm(requireReason ? reason.trim() : undefined)
      setReason('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-[var(--panel)] border border-[var(--line)] shadow-xl p-5">
        <h3 className="text-base font-semibold text-[var(--ink)]">{title}</h3>
        {description && <p className="mt-1.5 text-sm text-[var(--muted)]">{description}</p>}

        {children}

        {requireReason && (
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            rows={3}
            className="mt-3 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--brand-bright)] focus:outline-none"
          />
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--muted)] hover:bg-[var(--paper)]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit || submitting}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40 ${
              tone === 'danger' ? 'bg-[var(--status-escalated)]' : 'bg-[var(--brand)]'
            }`}
          >
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
