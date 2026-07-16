-- Fixes: claimed tickets not disappearing from *other* agents' open queue in
-- real time (required a hard refresh to see the ticket was taken).
--
-- Root cause: AgentDashboard/SeniorDashboard listen for changes via
-- `postgres_changes` on the `conversations` table. Supabase Realtime only
-- delivers a `postgres_changes` event to a client if the row (after the
-- change) still passes that client's SELECT RLS policy. Our
-- `conversations_select_agent` / `conversations_select_senior` policies only
-- grant visibility to `status = 'open'` rows or the agent's own
-- `agent_id = auth.uid()` rows. The moment a ticket is claimed, its new row
-- state (`status = 'assigned'`, `agent_id = <claiming agent>`) fails that
-- policy for every *other* agent — so Realtime silently drops the event for
-- them. They only find out the ticket is gone the next time they refetch
-- (e.g. on a hard refresh, or on a `postgres_changes` event for a *different*
-- row that happens to trigger their own `loadAll()`).
--
-- Fix: broadcast a small, non-row-shaped "the open queue changed" ping over
-- Realtime Broadcast (`realtime.send`) on a public topic whenever a ticket
-- enters or leaves the open queue (claimed, rejected back to queue, or a new
-- ticket escalated/created into `open`). Broadcast is independent of RLS on
-- `conversations` — it isn't gated by whether the recipient can currently
-- SELECT that row — so every connected agent/senior_agent gets the ping and
-- can just refetch their own view of the queue.
--
-- Safe to run multiple times.

create or replace function notify_queue_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_status text := case when TG_OP = 'INSERT' then null else old.status::text end;
  v_new_status text := new.status::text;
begin
  -- Only ping when the ticket is entering or leaving the shared 'open' queue.
  if v_new_status = 'open' or v_old_status = 'open' then
    perform realtime.send(
      jsonb_build_object(
        'conversation_id', new.id,
        'old_status', v_old_status,
        'new_status', v_new_status
      ),
      'queue_change',   -- event name
      'agent-queue',    -- topic — all agents/seniors subscribe to this
      false             -- public topic: no Realtime Authorization policy needed to listen
    );
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_queue_broadcast on conversations;
create trigger conversations_queue_broadcast
  after insert or update on conversations
  for each row execute function notify_queue_change();