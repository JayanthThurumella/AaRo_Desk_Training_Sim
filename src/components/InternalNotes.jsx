import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

export default function InternalNotes({ conversationId, readOnly = false }) {
  const { profile } = useAuth()
  const [notes, setNotes] = useState([])
  const [transferLogs, setTransferLogs] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false

    supabase
      .from('internal_notes')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setNotes(data ?? [])
      })

    // Transfer reasons are staff-only metadata (never shown in the chat itself) — surface them
    // here, in the internal notes timeline, so the receiving agent has context for the handoff.
    supabase
      .from('transfers')
      .select('*, from_agent:from_agent_id(full_name), to_agent:to_agent_id(full_name)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setTransferLogs(data ?? [])
      })

    const channel = supabase
      .channel(`notes-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'internal_notes', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setNotes((prev) => [...prev, payload.new])
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transfers', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setTransferLogs((prev) => [...prev, payload.new])
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setSending(true)
    const { error } = await supabase
      .from('internal_notes')
      .insert({ conversation_id: conversationId, author_id: profile.id, body })
    setSending(false)
    if (!error) setDraft('')
  }

  const timeline = [
    ...notes.map((n) => ({ kind: 'note', at: n.created_at, data: n })),
    ...transferLogs.map((t) => ({ kind: 'transfer', at: t.created_at, data: t })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))

  return (
    <div className="flex h-full flex-col bg-[color-mix(in_srgb,var(--signal)_6%,transparent)]">
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {timeline.length === 0 && (
          <p className="text-center text-xs text-[var(--muted)] mt-6">
            Internal notes — visible to staff only, never to the customer.
          </p>
        )}
        {timeline.map((item) =>
          item.kind === 'transfer' ? (
            <div
              key={`transfer-${item.data.id}`}
              className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel)]/60 px-3 py-2 text-sm"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Transferred{item.data.from_agent?.full_name ? ` from ${item.data.from_agent.full_name}` : ''}
                {item.data.to_agent?.full_name ? ` to ${item.data.to_agent.full_name}` : ''}
              </p>
              <p className="mt-0.5 text-[var(--ink)]">{item.data.reason}</p>
              <p className="mt-1 text-[10px] font-mono-data text-[var(--muted)]">
                {new Date(item.data.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          ) : (
            <div key={item.data.id} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm">
              <p className="text-[var(--ink)]">{item.data.body}</p>
              <p className="mt-1 text-[10px] font-mono-data text-[var(--muted)]">
                {new Date(item.data.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )
        )}
      </div>
      {!readOnly && (
        <div className="flex items-end gap-2 border-t border-[var(--line)] bg-[var(--panel)] p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Note to your team (customer never sees this)…"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm focus:border-[var(--signal)] focus:outline-none"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="rounded-lg bg-[var(--signal)] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Note
          </button>
        </div>
      )}
    </div>
  )
}