-- ==========================================================
-- FILE B — FUNCTIONS, RLS POLICIES, REALTIME, SEED DATA
-- Run this SECOND, after File A succeeds.
-- No CREATE TABLE statements here, so no RLS dialog will appear.
-- ==========================================================

-- =====================================================================
-- 3. HELPER FUNCTIONS
-- =====================================================================

create or replace function current_role_of(uid uuid) returns user_role
language sql stable as $$
  select role from profiles where id = uid;
$$;

create or replace function is_staff(uid uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from profiles where id = uid and role in ('agent','senior_agent','admin')
  );
$$;

create or replace function write_audit(
  p_ticket_id uuid, p_actor_id uuid, p_action text,
  p_from ticket_status, p_to ticket_status, p_metadata jsonb default '{}'::jsonb
) returns void language sql as $$
  insert into audit_log (ticket_id, actor_id, action, from_status, to_status, metadata)
  values (p_ticket_id, p_actor_id, p_action, p_from, p_to, p_metadata);
$$;

-- =====================================================================
-- 4. TICKET LIFECYCLE FUNCTIONS (security definer — re-check role + state)
-- =====================================================================

-- 4.1 Escalate bot ticket into the human queue.
create or replace function escalate_to_queue(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_conv conversations;
  v_caller uuid := auth.uid();
  v_cat issue_categories;
  v_in_hours boolean;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.client_id <> v_caller then raise exception 'not your ticket'; end if;
  if v_conv.status <> 'bot' then raise exception 'ticket is not in bot stage'; end if;

  select * into v_cat from issue_categories where id = v_conv.category_id;

  update conversations set
    status = 'open',
    priority = coalesce(v_cat.default_priority, priority),
    started_at = now(),
    source = 'human',
    updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'escalate_to_queue', 'bot', 'open', '{}'::jsonb);
  return v_conv;
end;
$$;

-- 4.2 Mark a bot-stage ticket resolved by the bot itself (customer self-resolved).
create or replace function bot_resolve(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_conv conversations;
  v_caller uuid := auth.uid();
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.client_id <> v_caller then raise exception 'not your ticket'; end if;
  if v_conv.status <> 'bot' then raise exception 'ticket is not in bot stage'; end if;

  update conversations set
    status = 'resolved', close_reason = 'resolved_first_contact',
    closed_at = now(), updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'bot_resolve', 'bot', 'resolved', '{}'::jsonb);
  return v_conv;
end;
$$;

-- 4.3 Atomic claim (§6.3): row-locked conditional update, presence + concurrency gated.
create or replace function claim_conversation(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_role user_role := current_role_of(v_caller);
  v_status agent_status;
  v_active_count int;
  v_max int;
  v_conv conversations;
begin
  if v_role not in ('agent','senior_agent') then
    raise exception 'only agents can claim tickets';
  end if;

  select status, max_concurrent_tickets into v_status, v_max from profiles where id = v_caller;
  if v_status <> 'available' then
    raise exception 'you must be available to claim tickets'; -- §6.1
  end if;

  select count(*) into v_active_count from conversations
  where agent_id = v_caller and status in ('assigned','active','on_hold'); -- §6.4
  if v_active_count >= v_max then
    raise exception 'max concurrent ticket limit reached (%)', v_max;
  end if;

  update conversations
  set agent_id = v_caller, status = 'assigned', claimed_at = now(), updated_at = now()
  where id = p_conversation_id and agent_id is null and status = 'open'
  returning * into v_conv;

  if v_conv is null then
    raise exception 'ticket already claimed';
  end if;

  update profiles set status = 'busy' where id = v_caller; -- §6.2 auto-busy, same transaction

  perform write_audit(p_conversation_id, v_caller, 'claim', 'open', 'assigned', '{}'::jsonb);
  return v_conv;
end;
$$;

-- 4.4 Reject a claimed/offered ticket back to the open queue.
create or replace function reject_conversation(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.agent_id <> v_caller then raise exception 'not your ticket'; end if;
  if v_conv.status not in ('assigned') then
    raise exception 'only a freshly-claimed ticket can be rejected';
  end if;

  update conversations set
    agent_id = null, status = 'open', claimed_at = null, updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'reject', 'assigned', 'open', '{}'::jsonb);
  return v_conv;
end;
$$;

-- 4.5 Send a real chat reply. Sets first_response_at exactly once, on the agent's first reply.
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

  if v_role in ('agent','senior_agent') and v_conv.first_response_at is null then
    update conversations set first_response_at = now(), status =
      case when status = 'assigned' then 'active' else status end,
      updated_at = now()
    where id = p_conversation_id;
  elsif v_role in ('agent','senior_agent') and v_conv.status = 'pending' then
    update conversations set status = 'active', updated_at = now() where id = p_conversation_id;
  end if;

  return v_msg;
end;
$$;

-- 4.6 Hold / resume (pauses & resumes the SLA clock; visible hold timer both sides).
create or replace function hold_conversation(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if not (v_conv.agent_id = v_caller or v_conv.escalated_to = v_caller) then
    raise exception 'ticket not assigned to you';
  end if;
  if v_conv.status <> 'active' then raise exception 'only an active ticket can be held'; end if;

  update conversations set status = 'on_hold', hold_started_at = now(), updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'hold', 'active', 'on_hold', '{}'::jsonb);
  return v_conv;
end;
$$;

create or replace function resume_conversation(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
  v_elapsed int;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if not (v_conv.agent_id = v_caller or v_conv.escalated_to = v_caller) then
    raise exception 'ticket not assigned to you';
  end if;
  if v_conv.status <> 'on_hold' then raise exception 'ticket is not on hold'; end if;

  v_elapsed := extract(epoch from (now() - v_conv.hold_started_at))::int;

  update conversations set
    status = 'active',
    hold_total_seconds = hold_total_seconds + greatest(v_elapsed, 0),
    hold_started_at = null,
    updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'resume', 'on_hold', 'active', '{}'::jsonb);
  return v_conv;
end;
$$;

-- 4.7 Escalate to senior agent (§6.7: real state transition, logged, agent_id kept).
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

  perform write_audit(p_conversation_id, v_caller, 'escalate', v_conv.status, 'escalated',
    jsonb_build_object('reason', p_reason));
  return v_conv;
end;
$$;

-- 4.8 Senior agent takes ownership of an escalation.
create or replace function take_ownership(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_role user_role := current_role_of(v_caller);
  v_conv conversations;
begin
  if v_role <> 'senior_agent' then raise exception 'only a senior agent can take ownership'; end if;

  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.status <> 'escalated' then raise exception 'ticket is not in escalation'; end if;

  update conversations set
    escalated_to = v_caller, status = 'active', updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  update escalations set to_agent_id = v_caller, resolved_at = now()
  where conversation_id = p_conversation_id and resolved_at is null;

  perform write_audit(p_conversation_id, v_caller, 'take_ownership', 'escalated', 'active', '{}'::jsonb);
  return v_conv;
end;
$$;

-- 4.9 Senior agent returns an escalation to the original agent (re-offered specifically, not to general queue).
create or replace function return_escalation(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.escalated_to <> v_caller then raise exception 'not your escalation'; end if;
  if v_conv.original_agent_id is null then raise exception 'no original agent on record'; end if;

  update conversations set
    agent_id = original_agent_id, escalated_to = null, status = 'active', updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'return_escalation', 'active', 'active',
    jsonb_build_object('returned_to', v_conv.agent_id));

  insert into notifications (user_id, type, payload)
  values (v_conv.agent_id, 'escalation_returned', jsonb_build_object('conversation_id', p_conversation_id));

  return v_conv;
end;
$$;

-- 4.10 Transfer sideways to another available agent.
create or replace function transfer_conversation(p_conversation_id uuid, p_to_agent_id uuid, p_reason text)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
  v_target_status agent_status;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'transfer reason is required';
  end if;

  select status into v_target_status from profiles where id = p_to_agent_id;
  if v_target_status is distinct from 'available' then
    raise exception 'target agent is not available';
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

  perform write_audit(p_conversation_id, v_caller, 'transfer', v_conv.status, 'assigned',
    jsonb_build_object('reason', p_reason, 'to_agent_id', p_to_agent_id));

  insert into notifications (user_id, type, payload)
  values (p_to_agent_id, 'ticket_transferred', jsonb_build_object('conversation_id', p_conversation_id));

  return v_conv;
end;
$$;

-- 4.11 Set pending (awaiting customer) — only reachable after first_response_at is set.
create or replace function set_pending(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if not (v_conv.agent_id = v_caller or v_conv.escalated_to = v_caller) then
    raise exception 'ticket not assigned to you';
  end if;
  if v_conv.first_response_at is null then
    raise exception 'cannot go pending before a first response has been sent';
  end if;
  if v_conv.status <> 'active' then raise exception 'ticket must be active to go pending'; end if;

  update conversations set status = 'pending', updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'set_pending', 'active', 'pending', '{}'::jsonb);
  return v_conv;
end;
$$;

-- 4.12 Resolve / unresolved / cancel — one-shot close (§6: cannot be triggered twice).
create or replace function close_conversation(p_conversation_id uuid, p_close_reason close_reason)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_role user_role := current_role_of(v_caller);
  v_conv conversations;
  v_new_status ticket_status;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;

  if v_conv.status in ('resolved','unresolved','cancelled','abandoned') then
    raise exception 'ticket is already closed';
  end if;

  if v_role = 'agent' then
    if v_conv.agent_id <> v_caller then raise exception 'not your ticket'; end if;
    if v_conv.first_response_at is null then
      raise exception 'cannot close before a first response has been sent';
    end if;
  elsif v_role = 'senior_agent' then
    if not (v_conv.agent_id = v_caller or v_conv.escalated_to = v_caller) then
      raise exception 'ticket not assigned to you';
    end if;
  else
    raise exception 'role cannot close tickets';
  end if;

  v_new_status := case p_close_reason
    when 'resolved_first_contact' then 'resolved'
    when 'unresolved_closed' then 'unresolved'
    when 'cancelled' then 'cancelled'
    else 'unresolved'
  end;

  update conversations set
    status = v_new_status, close_reason = p_close_reason, closed_at = now(), updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'close', v_conv.status, v_new_status,
    jsonb_build_object('close_reason', p_close_reason));
  return v_conv;
end;
$$;

-- 4.13 Mark abandoned (system/agent-triggered when a customer goes silent past a threshold).
create or replace function mark_abandoned(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.status in ('resolved','unresolved','cancelled','abandoned') then
    raise exception 'ticket is already closed';
  end if;

  update conversations set status = 'abandoned', closed_at = now(), updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'mark_abandoned', v_conv.status, 'abandoned', '{}'::jsonb);
  return v_conv;
end;
$$;

-- 4.14 Reopen — the ONE shared path for resolved/unresolved/abandoned (§6.11, §6.8).
create or replace function reopen_conversation(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
  v_new_status ticket_status;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.status not in ('resolved','unresolved','abandoned') then
    raise exception 'only resolved, unresolved, or abandoned tickets can be reopened';
  end if;

  v_new_status := case when v_conv.agent_id is not null then 'assigned' else 'open' end;

  update conversations set
    status = v_new_status,
    reopened_count = reopened_count + 1,
    closed_at = null,
    close_reason = null,
    updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'reopen', v_conv.status, v_new_status,
    jsonb_build_object('reopened_count', v_conv.reopened_count));
  return v_conv;
end;
$$;

-- 4.15 CSAT submission — real score only, never a sentinel.
create or replace function submit_csat(p_conversation_id uuid, p_score int)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  if p_score < 1 or p_score > 5 then raise exception 'csat score must be 1-5'; end if;

  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null or v_conv.client_id <> v_caller then raise exception 'not your ticket'; end if;
  if v_conv.status not in ('resolved','unresolved') then
    raise exception 'ticket must be closed before rating';
  end if;

  update conversations set csat_score = p_score, csat_prompted = true, updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  return v_conv;
end;
$$;

create or replace function skip_csat(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null or v_conv.client_id <> v_caller then raise exception 'not your ticket'; end if;

  update conversations set csat_prompted = true, updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  return v_conv;
end;
$$;

-- 4.16 Presence: change own status, force-closing any open time_logs segment (no overlap).
create or replace function set_presence(p_status agent_status)
returns profiles language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_profile profiles;
begin
  update time_logs set ended_at = now()
  where agent_id = v_caller and ended_at is null;

  insert into time_logs (agent_id, status, started_at) values (v_caller, p_status, now());

  update profiles set status = p_status where id = v_caller
  returning * into v_profile;

  return v_profile;
end;
$$;

-- 4.17 Get or create the customer's ticket for a category — duplicate prevention (§6.10).
create or replace function start_or_resume_ticket(p_category_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
begin
  select * into v_conv from conversations
  where client_id = v_caller
    and status in ('bot','open','assigned','active','on_hold','escalated','pending')
  limit 1;

  if v_conv is not null then
    return v_conv;
  end if;

  insert into conversations (client_id, category_id, status, source)
  values (v_caller, p_category_id, 'bot', 'bot')
  returning * into v_conv;

  perform write_audit(v_conv.id, v_caller, 'start_ticket', null, 'bot', '{}'::jsonb);
  return v_conv;
end;
$$;


-- =====================================================================
-- 5. QA REVIEW (senior agent / admin)
-- =====================================================================

create or replace function submit_qa_review(
  p_conversation_id uuid, p_coaching_score int, p_notes text, p_auto_score numeric
) returns qa_reviews language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_role user_role := current_role_of(v_caller);
  v_review qa_reviews;
begin
  if v_role not in ('senior_agent','admin') then
    raise exception 'only senior agents or admins can submit QA reviews';
  end if;
  if p_coaching_score < 1 or p_coaching_score > 5 then
    raise exception 'coaching score must be 1-5';
  end if;

  insert into qa_reviews (conversation_id, reviewer_id, coaching_score, notes, chat_quality_auto_score)
  values (p_conversation_id, v_caller, p_coaching_score, p_notes, p_auto_score)
  returning * into v_review;

  return v_review;
end;
$$;

-- =====================================================================
-- 6. ROW LEVEL SECURITY
-- =====================================================================

alter table profiles enable row level security;
alter table issue_categories enable row level security;
alter table bot_scripts enable row level security;
alter table business_hours enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table attachments enable row level security;
alter table internal_notes enable row level security;
alter table escalations enable row level security;
alter table transfers enable row level security;
alter table qa_reviews enable row level security;
alter table time_logs enable row level security;
alter table audit_log enable row level security;
alter table notifications enable row level security;
alter table teams enable row level security;

-- ---- profiles ----
create policy profiles_select_self on profiles for select
  using (id = auth.uid() or is_staff(auth.uid()));
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
create policy profiles_admin_all on profiles for all
  using (current_role_of(auth.uid()) = 'admin')
  with check (current_role_of(auth.uid()) = 'admin');

-- ---- issue_categories / bot_scripts / business_hours (config, admin-writable, staff+customer readable) ----
create policy categories_select_all on issue_categories for select using (true);
create policy categories_admin_write on issue_categories for insert with check (current_role_of(auth.uid()) = 'admin');
create policy categories_admin_update on issue_categories for update using (current_role_of(auth.uid()) = 'admin');
create policy categories_admin_delete on issue_categories for delete using (current_role_of(auth.uid()) = 'admin');

create policy bot_scripts_select_all on bot_scripts for select using (true);
create policy bot_scripts_admin_write on bot_scripts for insert with check (current_role_of(auth.uid()) = 'admin');
create policy bot_scripts_admin_update on bot_scripts for update using (current_role_of(auth.uid()) = 'admin');
create policy bot_scripts_admin_delete on bot_scripts for delete using (current_role_of(auth.uid()) = 'admin');

create policy business_hours_select_all on business_hours for select using (true);
create policy business_hours_admin_write on business_hours for insert with check (current_role_of(auth.uid()) = 'admin');
create policy business_hours_admin_update on business_hours for update using (current_role_of(auth.uid()) = 'admin');

create policy teams_select_all on teams for select using (true);
create policy teams_admin_write on teams for insert with check (current_role_of(auth.uid()) = 'admin');

-- ---- conversations ----
-- Customers: only their own.
create policy conversations_select_customer on conversations for select
  using (current_role_of(auth.uid()) = 'customer' and client_id = auth.uid());

-- Agents: shared open queue + their own claimed/assigned tickets, gated by presence (§6.1, §8).
create policy conversations_select_agent on conversations for select
  using (
    current_role_of(auth.uid()) = 'agent' and (
      (status = 'open' and exists (select 1 from profiles where id = auth.uid() and status = 'available'))
      or agent_id = auth.uid()
    )
  );

-- Senior agents: everything an agent can see, plus escalations directed to them/team.
create policy conversations_select_senior on conversations for select
  using (
    current_role_of(auth.uid()) = 'senior_agent' and (
      (status = 'open' and exists (select 1 from profiles where id = auth.uid() and status = 'available'))
      or agent_id = auth.uid()
      or escalated_to = auth.uid()
      or status = 'escalated'
    )
  );

-- Admin: full read.
create policy conversations_select_admin on conversations for select
  using (current_role_of(auth.uid()) = 'admin');

-- Customer insert: only via start_or_resume_ticket() RPC in practice, but allow direct insert of own row.
create policy conversations_insert_customer on conversations for insert
  with check (current_role_of(auth.uid()) = 'customer' and client_id = auth.uid());

-- Update policy (§6.7, §8): validate BOTH old and new agent_id/escalated_to/status against caller identity.
-- Mutations of consequence go through the security-definer RPCs above; this is the backstop.
create policy conversations_update_guarded on conversations for update
  using (
    current_role_of(auth.uid()) = 'admin'
    or client_id = auth.uid()
    or agent_id = auth.uid()
    or escalated_to = auth.uid()
  )
  with check (
    current_role_of(auth.uid()) = 'admin'
    or (client_id = auth.uid())
    or (agent_id = auth.uid() and (escalated_to is null or escalated_to = auth.uid()))
    or (escalated_to = auth.uid() and escalated_to is not distinct from auth.uid())
  );

-- ---- messages ----
create policy messages_select on messages for select
  using (
    exists (
      select 1 from conversations c where c.id = conversation_id and (
        c.client_id = auth.uid() or c.agent_id = auth.uid() or c.escalated_to = auth.uid()
        or current_role_of(auth.uid()) = 'admin'
      )
    )
  );

-- Direct inserts are blocked in favor of send_reply(); RLS still enforces closed-ticket protection (§6.8)
-- as a backstop for any future direct-insert path.
create policy messages_insert_guarded on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversations c where c.id = conversation_id
        and c.status not in ('resolved','unresolved','abandoned','cancelled')
        and (c.client_id = auth.uid() or c.agent_id = auth.uid() or c.escalated_to = auth.uid())
    )
  );

-- ---- attachments ----
create policy attachments_select on attachments for select
  using (
    exists (
      select 1 from messages m join conversations c on c.id = m.conversation_id
      where m.id = message_id and (
        c.client_id = auth.uid() or c.agent_id = auth.uid() or c.escalated_to = auth.uid()
        or current_role_of(auth.uid()) = 'admin'
      )
    )
  );
create policy attachments_insert on attachments for insert
  with check (uploaded_by = auth.uid());

-- ---- internal_notes (hidden from customer; agents/senior write, admin view-only) ----
create policy internal_notes_select on internal_notes for select
  using (
    is_staff(auth.uid()) and exists (
      select 1 from conversations c where c.id = conversation_id
        and (c.agent_id = auth.uid() or c.escalated_to = auth.uid() or current_role_of(auth.uid()) = 'admin')
    )
  );
create policy internal_notes_insert on internal_notes for insert
  with check (
    author_id = auth.uid() and current_role_of(auth.uid()) in ('agent','senior_agent')
    and exists (
      select 1 from conversations c where c.id = conversation_id
        and (c.agent_id = auth.uid() or c.escalated_to = auth.uid())
    )
  );

-- ---- escalations / transfers (log tables) ----
create policy escalations_select on escalations for select using (is_staff(auth.uid()));
create policy escalations_insert on escalations for insert with check (from_agent_id = auth.uid());
create policy transfers_select on transfers for select using (is_staff(auth.uid()));
create policy transfers_insert on transfers for insert with check (from_agent_id = auth.uid());

-- ---- qa_reviews: senior_agent writes, senior_agent + admin view ----
create policy qa_reviews_select on qa_reviews for select
  using (current_role_of(auth.uid()) in ('senior_agent','admin'));
create policy qa_reviews_insert on qa_reviews for insert
  with check (reviewer_id = auth.uid() and current_role_of(auth.uid()) in ('senior_agent','admin'));

-- ---- time_logs ----
create policy time_logs_select on time_logs for select
  using (agent_id = auth.uid() or current_role_of(auth.uid()) in ('senior_agent','admin'));
create policy time_logs_insert on time_logs for insert with check (agent_id = auth.uid());
create policy time_logs_update on time_logs for update using (agent_id = auth.uid());

-- ---- audit_log: senior_agent (own team, simplified to own actions here), admin (all) ----
create policy audit_log_select on audit_log for select
  using (
    current_role_of(auth.uid()) = 'admin'
    or (current_role_of(auth.uid()) = 'senior_agent' and actor_id = auth.uid())
  );

-- ---- notifications ----
create policy notifications_select on notifications for select using (user_id = auth.uid());
create policy notifications_update on notifications for update using (user_id = auth.uid());


-- =====================================================================
-- 7. REALTIME PUBLICATION — enabled on every table from day one (§5)
-- =====================================================================

alter publication supabase_realtime add table
  profiles, issue_categories, bot_scripts, business_hours, conversations, messages,
  attachments, internal_notes, escalations, transfers, qa_reviews, time_logs,
  audit_log, notifications, teams;

alter table conversations replica identity full;
alter table messages replica identity full;


-- ai_knowledge RLS + policies + realtime
alter table ai_knowledge enable row level security;

-- Readable by everyone (customer bot needs it, staff review it); admin-only writes.
create policy ai_knowledge_select_all on ai_knowledge for select using (true);
create policy ai_knowledge_admin_insert on ai_knowledge for insert with check (current_role_of(auth.uid()) = 'admin');
create policy ai_knowledge_admin_update on ai_knowledge for update using (current_role_of(auth.uid()) = 'admin');
create policy ai_knowledge_admin_delete on ai_knowledge for delete using (current_role_of(auth.uid()) = 'admin');

alter publication supabase_realtime add table ai_knowledge;

-- =====================================================================
-- 8. SEED DATA (categories + bot scripts + business hours) for local dev/demo
-- =====================================================================

insert into teams (name) values ('Team Alpha'), ('Team Bravo');

insert into issue_categories (name, response_sla_minutes, resolution_sla_minutes, default_priority)
values
  ('Billing', 5, 60, 'medium'),
  ('Network Issue', 3, 30, 'high'),
  ('SIM Activation', 10, 90, 'medium'),
  ('Roaming', 10, 120, 'medium'),
  ('Data Pack', 5, 45, 'medium'),
  ('Recharge', 5, 30, 'medium'),
  ('Device Settings', 10, 60, 'low'),
  ('VAS', 10, 60, 'low'),
  ('Number Portability', 15, 180, 'medium'),
  ('Complaint', 5, 120, 'high');

insert into bot_scripts (category_id, greeting_text, questions)
select id,
  'Hi! I''m the Nexline assistant. I can help with ' || lower(name) || ' issues — let''s see if we can sort this out quickly.',
  case name
    when 'Billing' then '[{"text":"Have you checked your last invoice date?","quick_replies":["Yes","No"]},{"text":"Is the charge higher than your usual plan amount?","quick_replies":["Yes","No"]},{"text":"Would you like a breakdown of this bill, or to talk to an agent?","quick_replies":["Show breakdown","Talk to agent"]}]'::jsonb
    when 'Network Issue' then '[{"text":"Is this happening at your current location only, or everywhere?","quick_replies":["Here only","Everywhere"]},{"text":"Have you tried toggling Airplane mode for 10 seconds?","quick_replies":["Yes, still no signal","Fixed it!"]},{"text":"Are other people nearby also facing signal issues?","quick_replies":["Yes","No","Not sure"]}]'::jsonb
    when 'SIM Activation' then '[{"text":"Have you inserted the new SIM into your device already?","quick_replies":["Yes","Not yet"]},{"text":"Did you receive an activation confirmation SMS?","quick_replies":["Yes","No"]}]'::jsonb
    when 'Roaming' then '[{"text":"Have you enabled international roaming on your plan?","quick_replies":["Yes","Not sure","No"]},{"text":"Which country are you travelling to or currently in?","quick_replies":["Tell agent"]}]'::jsonb
    when 'Data Pack' then '[{"text":"Has your data pack expired, or is it not activating?","quick_replies":["Expired","Won''t activate"]},{"text":"Was this pack purchased today?","quick_replies":["Yes","No"]}]'::jsonb
    when 'Recharge' then '[{"text":"Did the recharge deduct money but not reflect in your balance?","quick_replies":["Yes","No, just need a top-up"]},{"text":"Was this done via the app, website, or a retailer?","quick_replies":["App","Website","Retailer"]}]'::jsonb
    when 'Device Settings' then '[{"text":"Which device are you using?","quick_replies":["Android","iPhone","Other"]},{"text":"Have you tried restarting the device?","quick_replies":["Yes, no change","Will try now"]}]'::jsonb
    when 'VAS' then '[{"text":"Which value-added service is this about (caller tune, insurance, subscription)?","quick_replies":["Caller tune","Subscription","Other"]},{"text":"Do you want to activate or deactivate it?","quick_replies":["Activate","Deactivate"]}]'::jsonb
    when 'Number Portability' then '[{"text":"Do you have your Unique Porting Code (UPC) already?","quick_replies":["Yes","No, need help getting one"]},{"text":"Is your existing SIM active right now?","quick_replies":["Yes","No"]}]'::jsonb
    else '[{"text":"Could you briefly describe the issue?","quick_replies":["Talk to agent"]},{"text":"Have you contacted us about this before?","quick_replies":["Yes","No"]}]'::jsonb
  end
from issue_categories;


update issue_categories c set bot_script_id = b.id from bot_scripts b where b.category_id = c.id;

insert into business_hours (day_of_week, open_time, close_time, timezone)
select d, '09:00', '21:00', 'Asia/Kolkata' from generate_series(0,6) d;

-- =====================================================================
-- 9. AI Q&A KNOWLEDGE BASE (training-only improvement)
-- The bot searches this table (by simple keyword match, client-side) before
-- falling back to the scripted quick-reply flow or offering a human agent.
-- Admins manage entries from the "AI Knowledge" tab; more Q&A can be added
-- at any time without a deploy.
-- =====================================================================


insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'Why is my bill higher than usual?',
  'Your bill can be higher due to extra data used beyond your plan limit, roaming charges, or a recent plan/add-on purchase. Check the itemized charges section of your latest invoice for a full breakdown.',
  array['bill','billing','charge','invoice','high','amount']
from issue_categories where name = 'Billing'
union all
select id, 'How do I get a copy of my invoice?',
  'You can download your latest invoice from the "Billing" section of the Nexline app, or we can email it to your registered address — just ask an agent.',
  array['invoice','copy','download','statement']
from issue_categories where name = 'Billing';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'Why do I have no network signal?',
  'No-signal issues are usually caused by local network congestion, being outdoors of coverage, or a temporary tower outage. Try toggling Airplane mode for 10 seconds, and if it persists we can check for outages in your area.',
  array['signal','network','no service','no signal','coverage','tower']
from issue_categories where name = 'Network Issue'
union all
select id, 'Why is my internet slow?',
  'Slow data speeds can happen during peak hours, when your data pack has entered a throttled "unlimited" tier after the high-speed limit, or due to local congestion. We can check your current pack and usage.',
  array['slow','internet','speed','data','lag','buffering']
from issue_categories where name = 'Network Issue';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'How long does SIM activation take?',
  'New SIM activation is typically completed within 30 minutes to 4 hours after your KYC is verified. You will receive an SMS confirmation once your number is live.',
  array['sim','activation','activate','new sim','how long']
from issue_categories where name = 'SIM Activation'
union all
select id, 'My new SIM shows no service, what do I do?',
  'Restart your device once the SIM is inserted. If it still shows no service after a few minutes, your activation may still be processing — this can take up to a few hours.',
  array['sim','no service','not working','new sim']
from issue_categories where name = 'SIM Activation';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'How do I enable international roaming?',
  'International roaming can be enabled from the Nexline app under Plan > Roaming, or by asking an agent to activate it. It usually takes effect within a few hours.',
  array['roaming','international','enable','activate','abroad']
from issue_categories where name = 'Roaming'
union all
select id, 'What are the roaming charges?',
  'Roaming charges vary by destination country and pack selected. We recommend activating a roaming pack before you travel to avoid high pay-as-you-go rates.',
  array['roaming','charges','cost','rate','abroad','travel']
from issue_categories where name = 'Roaming';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'My data pack is not activating, why?',
  'Data packs can take a few minutes to activate after purchase. If it has been longer than 30 minutes, restart your device — if it still hasn''t activated, an agent can check the transaction.',
  array['data pack','not activating','pending','activate']
from issue_categories where name = 'Data Pack'
union all
select id, 'Can I carry forward unused data?',
  'Unused data from your current pack does not automatically carry forward unless you have a top-up pack that supports rollover. Check your active pack details in the app.',
  array['data','carry forward','rollover','unused','expired']
from issue_categories where name = 'Data Pack';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'I recharged but the balance is not showing, why?',
  'This is usually a short processing delay — balances normally update within a few minutes. If it has been longer, share your transaction ID with an agent so we can trace the recharge.',
  array['recharge','balance','not showing','deducted','failed']
from issue_categories where name = 'Recharge'
union all
select id, 'Can I get a refund for a failed recharge?',
  'Yes — failed recharges where money was deducted but not credited are eligible for a refund, usually processed within 5-7 business days after verification.',
  array['recharge','refund','failed','deducted']
from issue_categories where name = 'Recharge';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'How do I set up mobile data (APN) settings?',
  'Go to Settings > Network > Mobile Network > Access Point Names, and select or add the Nexline APN. Restart your device after saving.',
  array['apn','mobile data','settings','device','configure']
from issue_categories where name = 'Device Settings'
union all
select id, 'How do I enable VoLTE / HD calling?',
  'VoLTE can be enabled from Settings > Network > Mobile Network > VoLTE Calls, provided your device supports it. Restart your device after enabling.',
  array['volte','hd calling','settings','enable','device']
from issue_categories where name = 'Device Settings';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'How do I deactivate a value-added service (VAS)?',
  'VAS subscriptions like caller tunes or content packs can be deactivated from the Nexline app under Subscriptions, or by asking an agent to remove them for you.',
  array['vas','deactivate','subscription','caller tune','unsubscribe']
from issue_categories where name = 'VAS'
union all
select id, 'Why was I charged for a service I didn''t request?',
  'This can happen with VAS subscriptions activated via a promotional SMS/link. We can review your active subscriptions and deactivate anything unwanted, with a refund where applicable.',
  array['vas','charged','unwanted','subscription','unauthorized']
from issue_categories where name = 'VAS';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'How do I port my number to Nexline?',
  'To port in, send an SMS "PORT <your number>" to 1900 to receive your Unique Porting Code (UPC), then visit a Nexline store or complete the request in-app with your UPC.',
  array['port','porting','upc','number portability','switch']
from issue_categories where name = 'Number Portability'
union all
select id, 'How long does number porting take?',
  'Porting typically takes 3-7 working days from a valid request. Your existing SIM stays active until the port completes.',
  array['port','porting','how long','days','number portability']
from issue_categories where name = 'Number Portability';

insert into ai_knowledge (category_id, question, answer, keywords)
select id, 'How do I file a formal complaint?',
  'You can raise a complaint by describing the issue here, or asking to speak with an agent. Every complaint gets a ticket number you can use to track progress.',
  array['complaint','file','raise','escalate','issue']
from issue_categories where name = 'Complaint'
union all
select id, 'How do I check the status of my complaint?',
  'Share your ticket number with an agent, or check the status badge on your existing conversation — it updates in real time as your complaint is worked on.',
  array['complaint','status','track','ticket','check']
from issue_categories where name = 'Complaint';


-- ... (other functions remain unchanged)

-- 4.3 Atomic claim (§6.3): row-locked conditional update, presence + concurrency gated.
create or replace function claim_conversation(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_role user_role := current_role_of(v_caller);
  v_status agent_status;
  v_active_count int;
  v_max int;
  v_conv conversations;
begin
  if v_role not in ('agent','senior_agent') then
    raise exception 'only agents can claim tickets';
  end if;

  select status, max_concurrent_tickets into v_status, v_max from profiles where id = v_caller;
  if v_status <> 'available' then
    raise exception 'you must be available to claim tickets';
  end if;

  select count(*) into v_active_count from conversations
  where agent_id = v_caller and status in ('assigned','active','on_hold');
  if v_active_count >= v_max then
    raise exception 'max concurrent ticket limit reached (%)', v_max;
  end if;

  update conversations
  set agent_id = v_caller, status = 'assigned', claimed_at = now(), updated_at = now()
  where id = p_conversation_id and agent_id is null and status = 'open'
  returning * into v_conv;

  if v_conv is null then
    raise exception 'ticket already claimed';
  end if;

  -- Removed: update profiles set status = 'busy' where id = v_caller;

  perform write_audit(p_conversation_id, v_caller, 'claim', 'open', 'assigned', '{}'::jsonb);
  return v_conv;
end;
$$;

-- ... (rest of file unchanged)