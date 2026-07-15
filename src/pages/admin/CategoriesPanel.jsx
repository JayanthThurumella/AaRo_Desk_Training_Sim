import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ConfirmDialog from '../../components/ConfirmDialog'

const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const EMPTY_FORM = { name: '', response_sla_minutes: 5, resolution_sla_minutes: 60, default_priority: 'medium' }

export default function CategoriesPanel() {
  const [categories, setCategories] = useState([])
  const [savingId, setSavingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('issue_categories').select('*').order('name')
    setCategories(data ?? [])
  }
  useEffect(() => { load() }, [])

  const update = async (id, patch) => {
    setSavingId(id)
    const { error } = await supabase.from('issue_categories').update(patch).eq('id', id)
    setSavingId(null)
    if (error) alert(error.message)
    else setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const createCategory = async () => {
    if (!form.name.trim()) {
      setCreateError('Name is required.')
      return
    }
    setCreating(true)
    setCreateError(null)
    const { error } = await supabase.from('issue_categories').insert({
      name: form.name.trim(),
      response_sla_minutes: form.response_sla_minutes,
      resolution_sla_minutes: form.resolution_sla_minutes,
      default_priority: form.default_priority,
    })
    setCreating(false)
    if (error) setCreateError(error.message)
    else {
      setForm(EMPTY_FORM)
      load()
    }
  }

  const deleteCategory = async () => {
    if (!deleteTarget) return
    const { error } = await supabase.from('issue_categories').delete().eq('id', deleteTarget.id)
    if (error) alert(error.message)
    else setCategories((prev) => prev.filter((c) => c.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  return (
    <div className="p-4">
      <h2 className="mb-1 text-base font-semibold text-[var(--ink)]">Categories & SLAs</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Response SLA starts when a ticket enters the human queue. Resolution SLA runs until close.
      </p>

      <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <p className="mb-3 text-sm font-semibold text-[var(--ink)]">Add a category</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium text-[var(--muted)]">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Complaint"
              className="w-48 rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-sm"
            />
          </label>
          <LabeledInput
            label="Response SLA (min)"
            value={form.response_sla_minutes}
            onChange={(v) => setForm((f) => ({ ...f, response_sla_minutes: v }))}
          />
          <LabeledInput
            label="Resolution SLA (min)"
            value={form.resolution_sla_minutes}
            onChange={(v) => setForm((f) => ({ ...f, resolution_sla_minutes: v }))}
          />
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium text-[var(--muted)]">Default priority</span>
            <select
              value={form.default_priority}
              onChange={(e) => setForm((f) => ({ ...f, default_priority: e.target.value }))}
              className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5"
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <button
            onClick={createCategory}
            disabled={creating}
            className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creating ? 'Adding…' : 'Add category'}
          </button>
        </div>
        {createError && <p className="mt-2 text-xs text-[var(--status-escalated)]">{createError}</p>}
      </div>

      <div className="space-y-2">
        {categories.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
            <div className="min-w-[10rem] flex-1">
              <p className="text-sm font-medium text-[var(--ink)]">{c.name}</p>
              <p className="text-[11px] text-[var(--muted)]">{c.active ? 'Active' : 'Disabled'}</p>
            </div>

            <LabeledInput
              label="Response SLA (min)"
              value={c.response_sla_minutes}
              disabled={savingId === c.id}
              onChange={(v) => update(c.id, { response_sla_minutes: v })}
            />
            <LabeledInput
              label="Resolution SLA (min)"
              value={c.resolution_sla_minutes}
              disabled={savingId === c.id}
              onChange={(v) => update(c.id, { resolution_sla_minutes: v })}
            />

            <label className="flex flex-col text-xs">
              <span className="mb-1 font-medium text-[var(--muted)]">Default priority</span>
              <select
                value={c.default_priority}
                disabled={savingId === c.id}
                onChange={(e) => update(c.id, { default_priority: e.target.value })}
                className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
              <input
                type="checkbox"
                checked={c.active}
                disabled={savingId === c.id}
                onChange={(e) => update(c.id, { active: e.target.checked })}
              />
              Active
            </label>

            <button
              onClick={() => setDeleteTarget(c)}
              disabled={savingId === c.id}
              className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:border-[var(--status-escalated)] hover:text-[var(--status-escalated)]"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Existing tickets keep their history, but this category will no longer be offered to customers or usable for new tickets."
        tone="danger"
        confirmLabel="Delete category"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteCategory}
      />
    </div>
  )
}

function LabeledInput({ label, value, onChange, disabled }) {
  return (
    <label className="flex flex-col text-xs">
      <span className="mb-1 font-medium text-[var(--muted)]">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 font-mono-data"
      />
    </label>
  )
}
