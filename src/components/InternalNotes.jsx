import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'

export default function InternalNotes({ conversationId, readOnly = false }) {
  const { profile } = useAuth()
  const [notes, setNotes] = useState([])
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

    const channel = supabase
      .channel(`notes-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'internal_notes', filter: `conversation_id=eq.${conversationId}` },
        (payload) => setNotes((prev) => [...prev, payload.new])
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

  return (
    <div className="flex h-full flex-col bg-[color-mix(in_srgb,var(--signal)_6%,transparent)]">
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {notes.length === 0 && (
          <p className="text-center text-xs text-[var(--muted)] mt-6">
            Internal notes — visible to staff only, never to the customer.
          </p>
        )}
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm">
            <p className="text-[var(--ink)]">{n.body}</p>
            <p className="mt-1 text-[10px] font-mono-data text-[var(--muted)]">
              {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
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
