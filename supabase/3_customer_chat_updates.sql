-- ==========================================================
-- FILE C — CUSTOMER DASHBOARD / NEW CHAT WORKFLOW UPDATES
-- Run this THIRD, after Files A and B have been applied.
-- Additive only: one new column + new RPC functions.
-- Matches the existing security-definer RPC pattern from File B,
-- so no new grants are required (functions default to PUBLIC execute,
-- exactly like every other RPC in this project).
-- ==========================================================

-- =====================================================================
-- 1. Persist the bot transcript so agents can review it on claim.
--    (Previously the AI bot's questions/answers only lived in the
--    customer's browser state and were never written to `messages`,
--    so an agent claiming a ticket could not see what the bot said.)
-- =====================================================================
alter table messages
  add column if not exists is_bot_message boolean not null default false;

-- 1.1 Log one line of the bot transcript (bot prompt or customer reply
--     given during the bot stage). Kept separate from send_reply()
--     because the bot stage has no agent yet and needs its own guard.
create or replace function log_bot_message(
  p_conversation_id uuid, p_body text, p_is_bot boolean default false
) returns messages language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
  v_msg messages;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.client_id <> v_caller then raise exception 'not your ticket'; end if;
  if v_conv.status <> 'bot' then raise exception 'ticket is not in bot stage'; end if;

  insert into messages (conversation_id, sender_id, sender_role, body, is_bot_message)
  values (p_conversation_id, v_conv.client_id, 'customer', p_body, p_is_bot)
  returning * into v_msg;

  return v_msg;
end;
$$;

-- =====================================================================
-- 2. "My issue is not listed" — create (or reuse) a ticket and send it
--    straight to the agent queue, skipping the bot Q&A entirely.
-- =====================================================================
create or replace function start_and_escalate_ticket(p_category_id uuid default null)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
  v_cat issue_categories;
begin
  select * into v_conv from conversations
    where client_id = v_caller
      and status in ('bot','open','assigned','active','on_hold','escalated','pending')
    limit 1;

  if v_conv is null then
    insert into conversations (client_id, category_id, status, source)
    values (v_caller, p_category_id, 'bot', 'bot')
    returning * into v_conv;
    perform write_audit(v_conv.id, v_caller, 'start_ticket', null, 'bot',
      jsonb_build_object('reason', 'not_listed'));
  end if;

  if v_conv.status = 'bot' then
    select * into v_cat from issue_categories where id = v_conv.category_id;
    update conversations set
      status = 'open',
      priority = coalesce(v_cat.default_priority, priority),
      started_at = now(),
      source = 'human',
      updated_at = now()
    where id = v_conv.id
    returning * into v_conv;
    perform write_audit(v_conv.id, v_caller, 'escalate_to_queue', 'bot', 'open',
      jsonb_build_object('reason', 'not_listed'));
  end if;

  return v_conv;
end;
$$;

-- =====================================================================
-- 3. Customer-initiated exit ("Exit Chat" / "New Issue" confirmation).
--    - Still with the bot, never escalated  -> cancelled (quietly closed,
--      never touches the agent queue).
--    - Already queued / claimed / in progress -> abandoned (agent sees
--      the ticket status change so they know the customer left).
-- =====================================================================
create or replace function customer_exit_chat(p_conversation_id uuid)
returns conversations language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_conv conversations;
  v_prev_status ticket_status;
  v_new_status ticket_status;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then raise exception 'ticket not found'; end if;
  if v_conv.client_id <> v_caller then raise exception 'not your ticket'; end if;

  -- Idempotent: exiting an already-closed ticket is a no-op, not an error.
  if v_conv.status in ('resolved','unresolved','cancelled','abandoned') then
    return v_conv;
  end if;

  v_prev_status := v_conv.status;
  v_new_status := case when v_prev_status = 'bot' then 'cancelled' else 'abandoned' end;

  update conversations set
    status = v_new_status,
    close_reason = case when v_new_status = 'cancelled' then 'cancelled' else close_reason end,
    closed_at = now(),
    updated_at = now()
  where id = p_conversation_id
  returning * into v_conv;

  perform write_audit(p_conversation_id, v_caller, 'customer_exit_chat', v_prev_status, v_new_status, '{}'::jsonb);
  return v_conv;
end;
$$;