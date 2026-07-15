import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function CSATPrompt({ conversation, onDone }) {
  const [score, setScore] = useState(null)
  const [working, setWorking] = useState(false)

  const submit = async () => {
    if (!score) return
    setWorking(true)
    await supabase.rpc('submit_csat', { p_conversation_id: conversation.id, p_score: score })
    setWorking(false)
    onDone()
  }

  const skip = async () => {
    setWorking(true)
    await supabase.rpc('skip_csat', { p_conversation_id: conversation.id })
    setWorking(false)
    onDone()
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-8 shadow-sm">
        <h2 className="text-xl font-semibold text-[var(--ink)]">How did we do?</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Ticket {conversation.ticket_number} — rate your support experience.
        </p>

        <div className="mt-6 flex justify-center gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setScore(n)}
              className={`h-12 w-12 rounded-full border text-base font-semibold transition ${
                score === n
                  ? 'border-[var(--brand)] bg-[var(--brand)] text-white'
                  : 'border-[var(--line)] text-[var(--ink)] hover:border-[var(--brand-bright)]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-between px-2 text-xs text-[var(--muted)]">
          <span>Poor</span>
          <span>Excellent</span>
        </div>

        <div className="mt-8 flex justify-center gap-4">
          <button onClick={skip} disabled={working} className="text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors">
            Skip
          </button>
          <button
            onClick={submit}
            disabled={!score || working}
            className="rounded-lg bg-[var(--brand)] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[var(--brand-bright)] transition-colors"
          >
            Submit rating
          </button>
        </div>
      </div>
    </div>
  )
}