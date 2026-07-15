import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { searchKnowledge } from '../../utils/aiKnowledge'

const ESCALATE_TRIGGERS = ['talk to agent', 'talk to a human agent', 'need help getting one']

export default function BotChat({ conversation, script, onResolved, onEscalated }) {
  const [answers, setAnswers] = useState([])
  const [step, setStep] = useState(0)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)

  const [knowledge, setKnowledge] = useState([])
  const [askDraft, setAskDraft] = useState('')
  const [aiExchanges, setAiExchanges] = useState([])

  useEffect(() => {
    supabase.from('ai_knowledge').select('*').eq('active', true).then(({ data }) => setKnowledge(data ?? []))
  }, [])

  const askKnowledgeBase = () => {
    const q = askDraft.trim()
    if (!q) return
    const match = searchKnowledge(q, knowledge, { categoryId: conversation?.category_id })
    setAiExchanges((prev) => [...prev, match ? { question: q, answer: match.answer } : { question: q, notFound: true }])
    setAskDraft('')
  }

  const questions = script?.questions ?? []
  const done = step >= questions.length

  const handleReply = async (reply) => {
    const q = questions[step]
    setAnswers((prev) => [...prev, { question: q.text, reply }])

    if (ESCALATE_TRIGGERS.includes(reply.toLowerCase())) {
      await escalate()
      return
    }
    setStep((s) => s + 1)
  }

  const escalate = async () => {
    setWorking(true)
    setError(null)
    const { error: err } = await supabase.rpc('escalate_to_queue', { p_conversation_id: conversation.id })
    setWorking(false)
    if (err) setError(err.message)
    else onEscalated()
  }

  const resolve = async () => {
    setWorking(true)
    setError(null)
    const { error: err } = await supabase.rpc('bot_resolve', { p_conversation_id: conversation.id })
    setWorking(false)
    if (err) setError(err.message)
    else onResolved()
  }

  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 shadow-sm">
      <div className="flex h-[500px] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto pr-2">
          <BotBubble text={script?.greeting_text ?? "Hi! Let's see how I can help."} />

          {answers.map((a, i) => (
            <div key={i}>
              <BotBubble text={a.question} />
              <UserBubble text={a.reply} />
            </div>
          ))}

          {!done && questions[step] && (
            <BotBubble text={questions[step].text} />
          )}

          {aiExchanges.map((ex, i) => (
            <div key={`ai-${i}`}>
              <UserBubble text={ex.question} />
              <BotBubble
                text={
                  ex.notFound
                    ? "I couldn't find that in our help articles — you can keep going below, or talk to a human agent."
                    : ex.answer
                }
              />
            </div>
          ))}

          {done && !working && (
            <BotBubble text="Did that answer your question, or would you like a human agent to take a look?" />
          )}
        </div>

        {error && <p className="mb-2 text-xs text-[var(--status-escalated)]">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <input
            value={askDraft}
            onChange={(e) => setAskDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); askKnowledgeBase() } }}
            placeholder="Or type your own question…"
            className="flex-1 rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--brand-bright)] focus:outline-none"
          />
          <button
            onClick={askKnowledgeBase}
            disabled={!askDraft.trim()}
            className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-5 py-2 text-sm font-medium text-[var(--ink)] disabled:opacity-40 hover:border-[var(--brand-bright)] transition-colors"
          >
            Ask
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {!done && questions[step]?.quick_replies?.map((qr) => (
            <QuickReply key={qr} label={qr} disabled={working} onClick={() => handleReply(qr)} />
          ))}
          {done && (
            <>
              <QuickReply label="That solved it" disabled={working} onClick={resolve} />
              <QuickReply label="Talk to a human agent" disabled={working} onClick={escalate} emphasis />
            </>
          )}
        </div>
      </div>
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
      className={`rounded-full border px-4 py-1.5 text-sm font-medium disabled:opacity-40 transition-colors ${
        emphasis
          ? 'border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand-bright)]'
          : 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--brand-bright)]'
      }`}
    >
      {label}
    </button>
  )
}