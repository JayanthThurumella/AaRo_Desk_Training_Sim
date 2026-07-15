import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { autoChatQualityScore } from '../utils/kpi'

export default function QaReviewPanel({ ticket }) {
  const [messages, setMessages] = useState([])
  const [score, setScore] = useState(3)
  const [notes, setNotes] = useState('')
  const [existing, setExisting] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('messages').select('*').eq('conversation_id', ticket.id).then(({ data }) => setMessages(data ?? []))
    supabase
      .from('qa_reviews')
      .select('*')
      .eq('conversation_id', ticket.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setExisting(data))
  }, [ticket.id])

  const autoScore = autoChatQualityScore(ticket, messages)

  const submit = async () => {
    setSubmitting(true)
    const { data, error } = await supabase.rpc('submit_qa_review', {
      p_conversation_id: ticket.id,
      p_coaching_score: score,
      p_notes: notes.trim() || null,
      p_auto_score: autoScore,
    })
    setSubmitting(false)
    if (!error) {
      setExisting(data)
      setNotes('')
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Auto chat-quality score</p>
        <p className="mt-1 font-mono-data text-xl font-semibold text-[var(--ink)]">{autoScore.toFixed(1)} / 5</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Based on response time, reopens, and outcome — a starting point, not the verdict.</p>
      </div>

      {existing && (
        <div className="rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--brand)_6%,transparent)] p-3 text-sm">
          <p className="font-medium text-[var(--ink)]">Last review: {existing.coaching_score}/5</p>
          {existing.notes && <p className="mt-1 text-[var(--muted)]">{existing.notes}</p>}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-[var(--ink)]">Coaching score</p>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setScore(n)}
              className={`h-9 w-9 rounded-full border text-sm font-semibold ${
                score === n ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--line)] text-[var(--ink)]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Coaching notes for this agent…"
        rows={4}
        className="w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm focus:border-[var(--brand-bright)] focus:outline-none"
      />

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-lg bg-[var(--brand)] py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Submit review'}
      </button>
    </div>
  )
}
