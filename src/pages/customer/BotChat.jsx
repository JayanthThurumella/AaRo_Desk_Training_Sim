import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { searchKnowledge } from '../../utils/aiKnowledge'
import CategoryPicker from './CategoryPicker'

const ESCALATE_TRIGGERS = ['talk to agent', 'talk to a human agent', 'need help getting one']

function timeGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good Morning'
  if (h < 17) return 'Good Afternoon'
  return 'Good Evening'
}

/**
 * Handles the two pre-agent stages of a customer conversation:
 *  - "draft"  — conversation is null: nothing persisted yet. Shows the
 *               time-based greeting + horizontal service cards.
 *  - "script" — conversation.status === 'bot': ticket exists, plays the
 *               category's bot_scripts questions one at a time.
 *
 * The parent (SupportPage) is expected to render this with a `key` tied to
 * the conversation id (or 'draft') so switching tickets always gets a fresh
 * mount instead of trying to patch state in place — that's what keeps the
 * step-by-step flow honest and duplicate-free.
 */
export default function BotChat({
  conversation,
  categories,
  onTicketStarted,
  onResolved,
  onEscalated,
  onExitRequest,
}) {
  const greetingText = useMemo(() => `${timeGreeting()}! I'm the AI Assistant. How can I help you today?`, [])

  const [ticket, setTicket] = useState(conversation)
  const [script, setScript] = useState(null)
  const [transcript, setTranscript] = useState([]) // [{ role: 'bot' | 'customer', text }]
  const [step, setStep] = useState(0)
  const [resuming, setResuming] = useState(!!conversation)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [askDraft, setAskDraft] = useState('')
  const [knowledge, setKnowledge] = useState([])

  const creatingRef = useRef(false)
  const escalatingRef = useRef(false)

  useEffect(() => {
    supabase.from('ai_knowledge').select('*').eq('active', true).then(({ data }) => setKnowledge(data ?? []))
  }, [])

  // Resume an existing bot-stage ticket by replaying its logged transcript —
  // this is the only source of truth, so a page reload can never re-ask or
  // duplicate a question that was already asked.
  useEffect(() => {
    if (!conversation) return
    let cancelled = false

    async function resume() {
      setResuming(true)
      const [{ data: scriptData }, { data: msgs, error: msgErr }] = await Promise.all([
        conversation.category_id
          ? supabase.from('bot_scripts').select('*').eq('category_id', conversation.category_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: true }),
      ])
      if (cancelled) return
      if (msgErr) {
        setError(msgErr.message)
        setResuming(false)
        return
      }

      const rows = msgs ?? []
      const rebuilt = rows.map((r) => ({ role: r.is_bot_message ? 'bot' : 'customer', text: r.body }))
      const qTexts = (scriptData?.questions ?? []).map((q) => q.text)

      let matchedCount = 0
      for (const r of rows) {
        if (r.is_bot_message && matchedCount < qTexts.length && r.body === qTexts[matchedCount]) {
          matchedCount += 1
        }
      }
      const lastRow = rows[rows.length - 1]
      const stillAwaiting =
        lastRow && lastRow.is_bot_message && matchedCount > 0 && lastRow.body === qTexts[matchedCount - 1]

      setScript(scriptData ?? null)
      setTranscript(rebuilt)
      setTicket(conversation)
      setStep(stillAwaiting ? matchedCount - 1 : matchedCount)
      setResuming(false)
    }

    resume()
    return () => {
      cancelled = true
    }
    // conversation is fixed for the lifetime of this mount (parent remounts via `key` on switch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const questions = script?.questions ?? []
  const done = !!ticket && !resuming && step >= questions.length

  const appendLocal = (item) => setTranscript((prev) => [...prev, item])

  const logMessage = async (conversationId, body, isBot) => {
    const { error: err } = await supabase.rpc('log_bot_message', {
      p_conversation_id: conversationId,
      p_body: body,
      p_is_bot: isBot,
    })
    if (err) throw err
  }

  // ---- Draft stage: pick a service, or say the issue isn't listed ----

  const selectCategory = async (category) => {
    if (busy || creatingRef.current) return
    creatingRef.current = true
    setBusy(true)
    setError(null)
    try {
      const { data: conv, error: startErr } = await supabase.rpc('start_or_resume_ticket', {
        p_category_id: category.id,
      })
      if (startErr) throw startErr

      const { data: existing } = await supabase.from('messages').select('id').eq('conversation_id', conv.id).limit(1)
      const nextTranscript = []
      if (!existing || existing.length === 0) {
        await logMessage(conv.id, greetingText, true)
        nextTranscript.push({ role: 'bot', text: greetingText })
      }
      await logMessage(conv.id, `Selected: ${category.name}`, false)
      nextTranscript.push({ role: 'customer', text: `Selected: ${category.name}` })

      const { data: scriptData } = await supabase
        .from('bot_scripts')
        .select('*')
        .eq('category_id', category.id)
        .maybeSingle()
      const qs = scriptData?.questions ?? []

      if (qs.length > 0) {
        await logMessage(conv.id, qs[0].text, true)
        nextTranscript.push({ role: 'bot', text: qs[0].text })
      } else {
        const fallback = "I don't have automated steps for this yet — let's get you connected with an agent."
        await logMessage(conv.id, fallback, true)
        nextTranscript.push({ role: 'bot', text: fallback })
      }

      setScript(scriptData ?? null)
      setTicket(conv)
      setTranscript(nextTranscript)
      setStep(0)
      onTicketStarted?.(conv)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      creatingRef.current = false
    }
  }

  const selectNotListed = async () => {
    if (busy || creatingRef.current) return
    creatingRef.current = true
    setBusy(true)
    setError(null)
    try {
      const { data: conv, error: startErr } = await supabase.rpc('start_or_resume_ticket', { p_category_id: null })
      if (startErr) throw startErr

      const { data: existing } = await supabase.from('messages').select('id').eq('conversation_id', conv.id).limit(1)
      if (!existing || existing.length === 0) {
        await logMessage(conv.id, greetingText, true)
      }
      await logMessage(conv.id, 'My issue is not listed', false)

      const { data: escalated, error: escErr } = await supabase.rpc('start_and_escalate_ticket', {
        p_category_id: null,
      })
      if (escErr) throw escErr
      onEscalated?.(escalated)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
      creatingRef.current = false
    }
  }

  // ---- Script stage: quick replies drive the strict step-by-step flow ----

  const handleReply = async (replyText) => {
    if (busy || done || !ticket) return
    setBusy(true)
    setError(null)
    try {
      await logMessage(ticket.id, replyText, false)
      appendLocal({ role: 'customer', text: replyText })

      if (ESCALATE_TRIGGERS.includes(replyText.toLowerCase())) {
        await doEscalate()
        return
      }

      const nextIndex = step + 1
      if (nextIndex < questions.length) {
        await logMessage(ticket.id, questions[nextIndex].text, true)
        appendLocal({ role: 'bot', text: questions[nextIndex].text })
      }
      setStep(nextIndex)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const askKnowledgeBase = async () => {
    const q = askDraft.trim()
    if (!q || busy || !ticket) return
    setBusy(true)
    setError(null)
    try {
      await logMessage(ticket.id, q, false)
      appendLocal({ role: 'customer', text: q })

      const match = searchKnowledge(q, knowledge, { categoryId: ticket.category_id })
      const answerText = match
        ? match.answer
        : "I couldn't find that in our help articles — you can keep going below, or connect with a human agent."
      await logMessage(ticket.id, answerText, true)
      appendLocal({ role: 'bot', text: answerText })
      setAskDraft('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const resolve = async () => {
    if (busy || !ticket) return
    setBusy(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.rpc('bot_resolve', { p_conversation_id: ticket.id })
      if (err) throw err
      onResolved?.(data)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const doEscalate = async () => {
    if (escalatingRef.current || !ticket) return
    escalatingRef.current = true
    setBusy(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.rpc('escalate_to_queue', { p_conversation_id: ticket.id })
      if (err) throw err
      onEscalated?.(data)
    } catch (e) {
      setError(e.message)
      escalatingRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <span className="text-sm font-semibold text-[var(--ink)]">AI Assistant</span>
        <button
          onClick={onExitRequest}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition-colors hover:border-[var(--status-escalated)] hover:text-[var(--status-escalated)]"
        >
          Exit Chat
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!ticket && <BotBubble text={greetingText} />}

        {!ticket && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              <CategoryPicker
                categories={categories}
                onSelect={selectCategory}
                onNotListed={selectNotListed}
                disabled={busy}
              />
            </div>
          </div>
        )}

        {resuming && <p className="text-center text-xs text-[var(--muted)]">Loading your conversation…</p>}

        {transcript.map((m, i) =>
          m.role === 'bot' ? <BotBubble key={i} text={m.text} /> : <UserBubble key={i} text={m.text} />
        )}

        {done && !busy && (
          <BotBubble text="Did that answer your question, or would you like a human agent to take a look?" />
        )}
      </div>

      {error && <p className="px-5 pb-1 text-xs text-[var(--status-escalated)]">{error}</p>}

      {ticket && !resuming && (
        <>
          <div className="flex items-center gap-2 border-t border-[var(--line)] px-5 pt-3">
            <input
              value={askDraft}
              onChange={(e) => setAskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  askKnowledgeBase()
                }
              }}
              placeholder="Or type your own question…"
              className="flex-1 rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--brand-bright)] focus:outline-none"
            />
            <button
              onClick={askKnowledgeBase}
              disabled={!askDraft.trim() || busy}
              className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-5 py-2 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--brand-bright)] disabled:opacity-40"
            >
              Ask
            </button>
          </div>

          <div className="flex flex-wrap gap-2 px-5 pb-4 pt-3">
            {!done &&
              questions[step]?.quick_replies?.map((qr) => (
                <QuickReply key={qr} label={qr} disabled={busy} onClick={() => handleReply(qr)} />
              ))}
            {done && (
              <>
                <QuickReply label="That solved it" disabled={busy} onClick={resolve} />
                <QuickReply label="Connect to Agent" disabled={busy} onClick={doEscalate} emphasis />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function BotBubble({ text }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--paper)] px-4 py-2.5 text-sm text-[var(--ink)] shadow-sm">
        <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">AaRo Bot</div>
        {text}
      </div>
    </div>
  )
}

function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[var(--brand)] px-4 py-2.5 text-sm text-white shadow-sm">
        {text}
      </div>
    </div>
  )
}

function QuickReply({ label, onClick, disabled, emphasis }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
        emphasis
          ? 'border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand-bright)]'
          : 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--brand-bright)]'
      }`}
    >
      {label}
    </button>
  )
}