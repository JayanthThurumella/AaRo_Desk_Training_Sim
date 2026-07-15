import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import ConfirmDialog from './ConfirmDialog'

const CLOSED = ['resolved', 'unresolved', 'cancelled', 'abandoned']

export default function TicketActions({ ticket, onChanged }) {
  const { profile } = useAuth()
  const [dialog, setDialog] = useState(null) // 'escalate' | 'transfer' | 'close_resolved' | 'close_unresolved' | 'close_cancelled'
  const [agents, setAgents] = useState([])
  const [transferTarget, setTransferTarget] = useState(null)
  const [error, setError] = useState(null)

  const mine = ticket.agent_id === profile.id
  const isMyEscalation = ticket.escalated_to === profile.id
  const canAct = mine || isMyEscalation

  useEffect(() => {
    if (dialog !== 'transfer') return
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'agent')
      .eq('status', 'available')
      .neq('id', profile.id)
      .then(({ data }) => setAgents(data ?? []))
  }, [dialog, profile.id])

  const call = async (fn, args = {}) => {
    setError(null)
    const { error: err } = await supabase.rpc(fn, args)
    if (err) setError(err.message)
    else onChanged?.()
  }

  if (CLOSED.includes(ticket.status)) {
    return (
      <div className="border-t border-[var(--line)] p-3">
        {error && <p className="mb-2 text-xs text-[var(--status-escalated)]">{error}</p>}
        <button
          onClick={() => call('reopen_conversation', { p_conversation_id: ticket.id })}
          className="w-full rounded-lg border border-[var(--line)] py-2 text-sm font-medium text-[var(--ink)] hover:border-[var(--brand-bright)]"
        >
          Reopen ticket
        </button>
      </div>
    )
  }

  if (ticket.status === 'assigned' && mine) {
    return (
      <div className="border-t border-[var(--line)] p-3 flex gap-2">
        {error && <p className="text-xs text-[var(--status-escalated)]">{error}</p>}
        <button
          onClick={() => call('reject_conversation', { p_conversation_id: ticket.id })}
          className="flex-1 rounded-lg border border-[var(--line)] py-2 text-sm font-medium text-[var(--muted)] hover:border-[var(--status-escalated)] hover:text-[var(--status-escalated)]"
        >
          Reject back to queue
        </button>
        <p className="flex-1 self-center text-center text-xs text-[var(--muted)]">Send a message to start the conversation</p>
      </div>
    )
  }

  if (ticket.status === 'escalated' && !isMyEscalation) {
    return (
      <div className="border-t border-[var(--line)] p-3">
        {profile.role === 'senior_agent' && (
          <button
            onClick={() => call('take_ownership', { p_conversation_id: ticket.id })}
            className="w-full rounded-lg bg-[var(--brand)] py-2 text-sm font-semibold text-white"
          >
            Take ownership
          </button>
        )}
      </div>
    )
  }

  if (!canAct) return null

  return (
    <div className="border-t border-[var(--line)] p-3">
      {error && <p className="mb-2 text-xs text-[var(--status-escalated)]">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {ticket.status === 'active' && (
          <ActionBtn onClick={() => call('hold_conversation', { p_conversation_id: ticket.id })}>Hold</ActionBtn>
        )}
        {ticket.status === 'on_hold' && (
          <ActionBtn onClick={() => call('resume_conversation', { p_conversation_id: ticket.id })} primary>Resume</ActionBtn>
        )}
        {ticket.status === 'active' && ticket.first_response_at && (
          <ActionBtn onClick={() => call('set_pending', { p_conversation_id: ticket.id })}>Awaiting customer</ActionBtn>
        )}
        {isMyEscalation && ticket.original_agent_id && (
          <ActionBtn onClick={() => call('return_escalation', { p_conversation_id: ticket.id })}>Return to {' '}original agent</ActionBtn>
        )}
        {mine && ['active', 'on_hold'].includes(ticket.status) && (
          <ActionBtn onClick={() => setDialog('escalate')} tone="warn">Escalate</ActionBtn>
        )}
        {['active', 'on_hold', 'pending'].includes(ticket.status) && (
          <ActionBtn onClick={() => setDialog('transfer')}>Transfer</ActionBtn>
        )}
        {ticket.first_response_at && (
          <>
            <ActionBtn onClick={() => setDialog('close_resolved')} tone="success">Resolve</ActionBtn>
            <ActionBtn onClick={() => setDialog('close_unresolved')} tone="warn">Close unresolved</ActionBtn>
          </>
        )}
        <ActionBtn onClick={() => setDialog('close_cancelled')} tone="muted">Cancel ticket</ActionBtn>
      </div>

      <ConfirmDialog
        open={dialog === 'escalate'}
        title="Escalate to a senior agent"
        description="This moves the ticket into the escalation queue for a senior agent to pick up."
        requireReason
        confirmLabel="Escalate"
        onCancel={() => setDialog(null)}
        onConfirm={async (reason) => {
          await call('escalate_conversation', { p_conversation_id: ticket.id, p_reason: reason })
          setDialog(null)
        }}
      />

      <ConfirmDialog
        open={dialog === 'transfer'}
        title="Transfer this ticket"
        description={
          agents.length === 0
            ? 'No other agents are currently available.'
            : 'Choose an available agent below, then confirm with a reason.'
        }
        requireReason={agents.length > 0}
        confirmLabel="Transfer"
        onCancel={() => { setDialog(null); setTransferTarget(null) }}
        onConfirm={async (reason) => {
          if (!transferTarget) return
          await call('transfer_conversation', {
            p_conversation_id: ticket.id, p_to_agent_id: transferTarget, p_reason: reason,
          })
          setDialog(null)
          setTransferTarget(null)
        }}
      >
        {agents.length > 0 && (
          <div className="mt-3 space-y-1">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="radio" name="transfer-target" checked={transferTarget === a.id} onChange={() => setTransferTarget(a.id)} />
                {a.full_name}
              </label>
            ))}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'close_resolved'}
        title="Mark as resolved"
        description="This closes the ticket as resolved on first contact."
        confirmLabel="Mark resolved"
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          await call('close_conversation', { p_conversation_id: ticket.id, p_close_reason: 'resolved_first_contact' })
          setDialog(null)
        }}
      />

      <ConfirmDialog
        open={dialog === 'close_unresolved'}
        title="Close as unresolved"
        description="Use this when the issue couldn't be fixed in this conversation."
        tone="danger"
        confirmLabel="Close unresolved"
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          await call('close_conversation', { p_conversation_id: ticket.id, p_close_reason: 'unresolved_closed' })
          setDialog(null)
        }}
      />

      <ConfirmDialog
        open={dialog === 'close_cancelled'}
        title="Cancel this ticket"
        tone="danger"
        confirmLabel="Cancel ticket"
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          await call('close_conversation', { p_conversation_id: ticket.id, p_close_reason: 'cancelled' })
          setDialog(null)
        }}
      />
    </div>
  )
}

function ActionBtn({ children, onClick, tone, primary }) {
  const toneClasses = {
    warn: 'border-[var(--status-hold)] text-[var(--status-hold)] hover:bg-[var(--status-hold)] hover:text-white',
    success: 'border-[var(--status-resolved)] text-[var(--status-resolved)] hover:bg-[var(--status-resolved)] hover:text-white',
    muted: 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--status-escalated)] hover:text-[var(--status-escalated)]',
  }
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
        primary
          ? 'border-[var(--brand)] bg-[var(--brand)] text-white'
          : toneClasses[tone] ?? 'border-[var(--line)] text-[var(--ink)] hover:border-[var(--brand-bright)]'
      }`}
    >
      {children}
    </button>
  )
}
