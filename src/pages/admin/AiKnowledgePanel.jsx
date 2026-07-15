import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ConfirmDialog from '../../components/ConfirmDialog'

const EMPTY_FORM = { category_id: '', question: '', answer: '', keywords: '' }

export default function AiKnowledgePanel() {
  const [entries, setEntries] = useState([])
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('all')

  const load = async () => {
    const [{ data: kb }, { data: cats }] = await Promise.all([
      supabase.from('ai_knowledge').select('*').order('created_at', { ascending: false }),
      supabase.from('issue_categories').select('*').order('name'),
    ])
    setEntries(kb ?? [])
    setCategories(cats ?? [])
  }
  useEffect(() => { load() }, [])

  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const createEntry = async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      setCreateError('Question and answer are both required.')
      return
    }
    setCreating(true)
    setCreateError(null)
    const { error } = await supabase.from('ai_knowledge').insert({
      category_id: form.category_id || null,
      question: form.question.trim(),
      answer: form.answer.trim(),
      keywords: splitKeywords(form.keywords),
    })
    setCreating(false)
    if (error) setCreateError(error.message)
    else {
      setForm(EMPTY_FORM)
      load()
    }
  }

  const toggleActive = async (entry) => {
    setSavingId(entry.id)
    const { error } = await supabase.from('ai_knowledge').update({ active: !entry.active }).eq('id', entry.id)
    setSavingId(null)
    if (error) alert(error.message)
    else setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, active: !e.active } : e)))
  }

  const deleteEntry = async () => {
    if (!deleteTarget) return
    const { error } = await supabase.from('ai_knowledge').delete().eq('id', deleteTarget.id)
    if (error) alert(error.message)
    else setEntries((prev) => prev.filter((e) => e.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  const visible = entries.filter((e) => categoryFilter === 'all' || e.category_id === categoryFilter)

  return (
    <div className="p-4">
      <h2 className="mb-1 text-base font-semibold text-[var(--ink)]">AI Question & Answer Knowledge Base</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        The bot searches these entries first when a customer types a question, before falling back to the scripted
        flow or offering a human agent.
      </p>

      <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <p className="mb-3 text-sm font-semibold text-[var(--ink)]">Add a Q&A entry</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium text-[var(--muted)]">Category (optional)</span>
            <select
              value={form.category_id}
              onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
              className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5"
            >
              <option value="">General / any category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 font-medium text-[var(--muted)]">Keywords (comma separated, optional)</span>
            <input
              value={form.keywords}
              onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
              placeholder="e.g. bill, invoice, charge"
              className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col text-xs sm:col-span-2">
            <span className="mb-1 font-medium text-[var(--muted)]">Question</span>
            <input
              value={form.question}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
              placeholder="e.g. Why is my bill higher than usual?"
              className="rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col text-xs sm:col-span-2">
            <span className="mb-1 font-medium text-[var(--muted)]">Answer</span>
            <textarea
              value={form.answer}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
              rows={3}
              placeholder="The answer the bot should give…"
              className="resize-none rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={createEntry}
            disabled={creating}
            className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creating ? 'Adding…' : 'Add entry'}
          </button>
          {createError && <p className="text-xs text-[var(--status-escalated)]">{createError}</p>}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-[var(--muted)]">Filter:</span>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1"
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {visible.length === 0 && <p className="py-6 text-center text-sm text-[var(--muted)]">No entries yet.</p>}
        {visible.map((e) => (
          <div key={e.id} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--ink)]">{e.question}</p>
                  {!e.active && (
                    <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)]">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{e.answer}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                  <span className="rounded-full border border-[var(--line)] px-2 py-0.5">
                    {categoryById.get(e.category_id)?.name ?? 'General'}
                  </span>
                  {(e.keywords ?? []).map((k) => (
                    <span key={k} className="font-mono-data">#{k}</span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => toggleActive(e)}
                  disabled={savingId === e.id}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] hover:border-[var(--brand-bright)]"
                >
                  {e.active ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => setDeleteTarget(e)}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:border-[var(--status-escalated)] hover:text-[var(--status-escalated)]"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this Q&A entry?"
        description={deleteTarget?.question}
        tone="danger"
        confirmLabel="Delete entry"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteEntry}
      />
    </div>
  )
}

function splitKeywords(raw) {
  return raw
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
}
