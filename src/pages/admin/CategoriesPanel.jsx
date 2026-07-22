import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ConfirmDialog from '../../components/ConfirmDialog'

const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const EMPTY_FORM = { name: '', response_sla_seconds: 5 * 60, resolution_sla_seconds: 60 * 60, default_priority: 'medium' }

// SLA values are always stored (and sent to the backend) in seconds — these
// units just control how the number is entered/displayed in this form.
const SLA_UNITS = { seconds: 1, minutes: 60, hours: 3600 }

function secondsToUnit(seconds, unit) {
  return Math.round((seconds / SLA_UNITS[unit]) * 100) / 100
}

function unitToSeconds(value, unit) {
  return Math.max(1, Math.round(Number(value) * SLA_UNITS[unit]))
}

export default function CategoriesPanel() {
  const [categories, setCategories] = useState([])
  const [savingId, setSavingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formUnits, setFormUnits] = useState({ response: 'minutes', resolution: 'minutes' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  // Per-category, per-field display unit (seconds/minutes/hours) — purely a
  // display/input preference, the stored value is always in seconds.
  const [rowUnits, setRowUnits] = useState({})

  const unitFor = (categoryId, field) => rowUnits[categoryId]?.[field] ?? 'minutes'
  const setUnitFor = (categoryId, field, unit) => {
    setRowUnits((prev) => ({ ...prev, [categoryId]: { ...prev[categoryId], [field]: unit } }))
  }

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
      response_sla_seconds: form.response_sla_seconds,
      resolution_sla_seconds: form.resolution_sla_seconds,
      default_priority: form.default_priority,
    })
    setCreating(false)
    if (error) setCreateError(error.message)
    else {
      setForm(EMPTY_FORM)
      setFormUnits({ response: 'minutes', resolution: 'minutes' })
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
        Enter each SLA in whichever unit is most convenient — seconds, minutes, or hours.
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
          <SlaInput
            label="Response SLA"
            seconds={form.response_sla_seconds}
            unit={formUnits.response}
            onUnitChange={(u) => setFormUnits((f) => ({ ...f, response: u }))}
            onSecondsChange={(s) => setForm((f) => ({ ...f, response_sla_seconds: s }))}
          />
          <SlaInput
            label="Resolution SLA"
            seconds={form.resolution_sla_seconds}
            unit={formUnits.resolution}
            onUnitChange={(u) => setFormUnits((f) => ({ ...f, resolution: u }))}
            onSecondsChange={(s) => setForm((f) => ({ ...f, resolution_sla_seconds: s }))}
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

            <SlaInput
              label="Response SLA"
              seconds={c.response_sla_seconds}
              unit={unitFor(c.id, 'response')}
              disabled={savingId === c.id}
              onUnitChange={(u) => setUnitFor(c.id, 'response', u)}
              onSecondsChange={(s) => update(c.id, { response_sla_seconds: s })}
            />
            <SlaInput
              label="Resolution SLA"
              seconds={c.resolution_sla_seconds}
              unit={unitFor(c.id, 'resolution')}
              disabled={savingId === c.id}
              onUnitChange={(u) => setUnitFor(c.id, 'resolution', u)}
              onSecondsChange={(s) => update(c.id, { resolution_sla_seconds: s })}
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

function SlaInput({ label, seconds, unit, onUnitChange, onSecondsChange, disabled }) {
  const displayValue = secondsToUnit(seconds ?? 0, unit)
  return (
    <div className="flex flex-col text-xs">
      <span className="mb-1 font-medium text-[var(--muted)]">{label}</span>
      <div className="flex gap-1">
        <input
          type="number"
          min={unit === 'seconds' ? 1 : 0.01}
          step={unit === 'seconds' ? 1 : 0.01}
          value={displayValue}
          disabled={disabled}
          onChange={(e) => onSecondsChange(unitToSeconds(e.target.value, unit))}
          className="w-20 rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1 font-mono-data"
        />
        <select
          value={unit}
          disabled={disabled}
          onChange={(e) => onUnitChange(e.target.value)}
          className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-1 py-1 text-[11px]"
        >
          <option value="seconds">sec</option>
          <option value="minutes">min</option>
          <option value="hours">hr</option>
        </select>
      </div>
    </div>
  )
}