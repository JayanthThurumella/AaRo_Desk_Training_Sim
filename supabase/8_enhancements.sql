-- ==========================================================
-- FILE — ENHANCEMENTS (escalation ownership note, reopen-as-new-session,
-- CSAT-after-abandon fix)
-- Run this AFTER files 1-7. Additive + safe CREATE OR REPLACE only —
-- no destructive changes to existing tables, data, or policies.
-- ==========================================================

-- =====================================================================
-- 1. Reopen Ticket Flow — customer-initiated reopen now creates a brand
--    new conversation ("new chat session") that goes straight to the
--    agent queue, instead of resurrecting the old row. The old ticket is
--    left exactly as it was (still 'resolved'/'unresolved'/'abandoned'),
--    so its full message history stays intact and is browsable read-only
--    from the customer's ticket History list — nothing about the old
--    conversation is mutated other than bumping reopened_count for
--    reporting continuity.
-- =====================================================================
alter table conversations
  add column if not exists parent_conversation_id uuid references conversations(id) on delete set null;

create index if not exists conversations_parent_idx on conversations (parent_conversation_id);

create or replace function reopen_ticket_new_session(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_old conversations;
  v_new conversations;
  v_cat issue_categories;
begin
  select * into v_old from conversations where id = p_conversation_id for update;
  if v_old is null then raise exception 'ticket not found'; end if;
  if v_old.client_id <> v_caller then raise exception 'not your ticket'; end if;
  if v_old.status not in ('resolved','unresolved','abandoned') then
    raise exception 'only resolved, unresolved, or abandoned tickets can be reopened';
  end if;

  select * into v_cat from issue_categories where id = v_old.category_id;

  insert into conversations (
    client_id, category_id, status, priority, source, started_at, parent_conversation_id
  ) values (
    v_caller, v_old.category_id, 'open', coalesce(v_cat.default_priority, v_old.priority), 'human', now(), v_old.id
  )
  returning * into v_new;

  -- Keep the reopened_count on the original ticket for continuity/reporting,
  -- without touching its status/closed_at/close_reason (history stays intact).
  update conversations set reopened_count = reopened_count + 1, updated_at = now()
  where id = v_old.id;

  perform write_audit(v_new.id, v_caller, 'reopen_new_session', null, 'open',
    jsonb_build_object('parent_conversation_id', v_old.id));

  return v_new;
end;
$$;

-- =====================================================================
-- 2. Customer Exit & Rating — submit_csat previously only accepted
--    'resolved' / 'unresolved' tickets. customer_exit_chat() marks an
--    in-progress ticket 'abandoned' when the customer exits, which made
--    the CSAT dialog that follows fail with "ticket must be closed before
--    rating". Abandoned is a valid closed state for rating purposes too.
-- =====================================================================
create or replace function submit_csat(p_conversation_id uuid, p_score int)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  if p_score < 1 or p_score > 5 then raise exception 'csat score must be 1-5'; end if;

  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null or v_conv.client_id <> v_caller then raise exception 'not your ticket'; end if;
  if v_conv.status not in ('resolved','unresolved','abandoned') then
    raise exception 'ticket must be closed before rating';
  end if;

  update conversations set csat_score = p_score, csat_prompted = true, updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  return v_conv;
end;
$$;

-- =====================================================================
-- 3. Escalation Internal Notes — automatically log the escalation reason
--    as an internal note (staff-only, never shown to the customer) so the
--    senior agent sees the "why" the instant they open Internal Notes
--    after take_ownership(). Everything else in escalate_conversation()
--    is unchanged.
-- =====================================================================
create or replace function escalate_conversation(p_conversation_id uuid, p_reason text)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'escalation reason is required';
  end if;

  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.agent_id <> v_caller then raise exception 'not your ticket'; end if;
  if v_conv.status not in ('active','on_hold') then
    raise exception 'ticket must be active or on hold to escalate';
  end if;

  update conversations set
    status = 'escalated', original_agent_id = coalesce(original_agent_id, v_caller),
    escalated_to = null, updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  insert into escalations (conversation_id, from_agent_id, reason)
  values (p_conversation_id, v_caller, p_reason);

  insert into internal_notes (conversation_id, author_id, body)
  values (p_conversation_id, v_caller, 'Escalation reason: ' || p_reason);

  perform write_audit(p_conversation_id, v_caller, 'escalate', v_conv.status, 'escalated',
    jsonb_build_object('reason', p_reason));
  return v_conv;
end;
$$;
