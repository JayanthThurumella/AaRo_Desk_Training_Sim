-- Run in Supabase SQL Editor.
-- Fixes: a second, duplicate CREATE OR REPLACE of claim_conversation() had
-- been appended later in your schema file and was silently overriding this
-- one (Postgres just keeps the last CREATE OR REPLACE). This is the single
-- canonical version — safe to run even if your DB already has it.
--
-- Behavior: atomic claim (row-locked, conditional UPDATE) so two agents can
-- never claim the same ticket. Busy-status is intentionally NOT set here —
-- it's driven client-side from active-ticket-count vs max_concurrent_tickets
-- (see AgentDashboard.jsx / SeniorDashboard.jsx), so an agent whose
-- max_concurrent_tickets > 1 correctly stays "available" after one claim.

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

  -- §6.2 auto-busy is driven client-side from active-ticket-count vs
  -- max_concurrent_tickets (see AgentDashboard/SeniorDashboard), not here —
  -- an agent whose max is >1 should stay available after a single claim.

  perform write_audit(p_conversation_id, v_caller, 'claim', 'open', 'assigned', '{}'::jsonb);
  return v_conv;
end;
$$;
