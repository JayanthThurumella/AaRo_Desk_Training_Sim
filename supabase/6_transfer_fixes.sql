-- ==========================================================
-- FILE — TRANSFER WORKFLOW FIXES
-- Run this AFTER files 1-5.
-- Fixes two problems in the transfer workflow:
--   1) send_reply() only flipped 'assigned' -> 'active' on the very first
--      reply of the whole ticket (gated on first_response_at is null). After
--      a transfer, first_response_at is already set from the previous
--      agent's reply, so the receiving agent's first message never
--      reactivated the ticket — it stayed stuck on 'assigned', which only
--      renders "Reject back to queue" / "Send a message to start the
--      conversation" in the UI, forever.
--   2) transfer_conversation() only allowed transferring to a profile with
--      role = 'agent' (enforced client-side in the UI query) and had no
--      server-side role checks at all. This adds real Agent <-> Agent and
--      Senior Agent <-> Senior Agent transfers, plus Senior Agent -> Agent,
--      enforced in the function itself (not just the UI).
-- ==========================================================

-- 4.5 Send a real chat reply. Sets first_response_at exactly once overall,
-- but re-activates 'assigned' -> 'active' on every new assignment (including
-- after a transfer), so the receiving agent's first message unlocks the
-- normal action set (Resolve, Unresolved, Transfer, etc.) instead of
-- leaving the ticket stuck showing only "Send a message to start the
-- conversation".
create or replace function send_reply(p_conversation_id uuid, p_body text)
returns messages language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_role user_role := current_role_of(v_caller);
  v_conv conversations;
  v_msg messages;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;

  if v_role = 'customer' then
    if v_conv.client_id <> v_caller then raise exception 'not your ticket'; end if;
    -- writing into a closed ticket reopens it first (§6.8)
    if v_conv.status in ('resolved','unresolved','abandoned','cancelled') then
      perform reopen_conversation(p_conversation_id);
      select * into v_conv from conversations where id = p_conversation_id for update;
    end if;
  elsif v_role in ('agent','senior_agent') then
    if not (v_conv.agent_id = v_caller or v_conv.escalated_to = v_caller) then
      raise exception 'ticket not assigned to you'; -- §6.7 canEdit mirrored server-side
    end if;
    if v_conv.status in ('resolved','unresolved','abandoned','cancelled') then
      raise exception 'cannot write into a closed ticket';
    end if;
  else
    raise exception 'role cannot send replies';
  end if;

  insert into messages (conversation_id, sender_id, sender_role, body)
  values (p_conversation_id, v_caller, v_role, p_body)
  returning * into v_msg;

  if v_role in ('agent','senior_agent') and v_conv.status = 'assigned' then
    -- Covers both the very first reply on a ticket AND the receiving
    -- agent's first reply after a transfer. first_response_at is only
    -- ever set the first time it's null; on a transfer it's left as-is.
    update conversations set
      first_response_at = coalesce(first_response_at, now()),
      status = 'active',
      updated_at = now()
    where id = p_conversation_id;
  elsif v_role in ('agent','senior_agent') and v_conv.status = 'pending' then
    update conversations set status = 'active', updated_at = now() where id = p_conversation_id;
  end if;

  return v_msg;
end;
$$;

-- 4.10 Transfer sideways to another available agent/senior agent.
-- Allowed pairs (§ telecom workflow):
--   agent          -> agent
--   senior_agent   -> senior_agent
--   senior_agent   -> agent
-- (agent -> senior_agent is deliberately NOT a transfer path — that's what
-- escalate_conversation()/take_ownership() are for.)
-- The reason is required and stored only in the transfers table + audit
-- log — it's never written into messages, so it never shows up in the
-- customer chat or the receiving agent's conversation view.
create or replace function transfer_conversation(p_conversation_id uuid, p_to_agent_id uuid, p_reason text)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role user_role := current_role_of(v_caller);
  v_target_role user_role;
  v_target_status agent_status;
  v_conv conversations;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'transfer reason is required';
  end if;

  if v_caller_role not in ('agent','senior_agent') then
    raise exception 'only an agent or senior agent can transfer a ticket';
  end if;

  if p_to_agent_id = v_caller then
    raise exception 'cannot transfer a ticket to yourself';
  end if;

  select role, status into v_target_role, v_target_status from profiles where id = p_to_agent_id;
  if v_target_role is null then raise exception 'target agent not found'; end if;
  if v_target_status is distinct from 'available' then
    raise exception 'target agent is not available';
  end if;

  if v_caller_role = 'agent' and v_target_role <> 'agent' then
    raise exception 'agents can only transfer to another agent';
  end if;
  if v_caller_role = 'senior_agent' and v_target_role not in ('agent','senior_agent') then
    raise exception 'senior agents can only transfer to an agent or senior agent';
  end if;

  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if not (v_conv.agent_id = v_caller or v_conv.escalated_to = v_caller) then
    raise exception 'ticket not assigned to you';
  end if;

  update conversations set
    agent_id = p_to_agent_id, escalated_to = null, status = 'assigned',
    claimed_at = now(), updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  insert into transfers (conversation_id, from_agent_id, to_agent_id, reason)
  values (p_conversation_id, v_caller, p_to_agent_id, p_reason);

  -- Reason is metadata/logs only (audit_log + transfers table) — intentionally
  -- never inserted into the messages table, so it can't leak into any chat view.
  perform write_audit(p_conversation_id, v_caller, 'transfer', v_conv.status, 'assigned',
    jsonb_build_object('reason', p_reason, 'to_agent_id', p_to_agent_id));

  insert into notifications (user_id, type, payload)
  values (p_to_agent_id, 'ticket_transferred', jsonb_build_object('conversation_id', p_conversation_id));

  return v_conv;
end;
$$;
