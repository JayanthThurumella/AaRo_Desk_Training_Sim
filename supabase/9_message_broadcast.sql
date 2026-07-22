-- Fixes: unread-message badge in AgentDashboard/SeniorDashboard sidebars never
-- appearing, even though the new message itself shows up fine once the ticket
-- is opened.
--
-- Root cause: the badge listener subscribes to `postgres_changes` INSERT on
-- the `messages` table directly (see AgentDashboard.jsx / SeniorDashboard.jsx,
-- `messages-unread-${profile.id}` channel). Supabase Realtime only forwards a
-- `postgres_changes` event if the row passes the subscriber's SELECT RLS
-- policy, and `messages_select` is a cross-table `EXISTS (... join
-- conversations ...)` check:
--
--   create policy messages_select on messages for select
--     using (
--       exists (
--         select 1 from conversations c where c.id = conversation_id and (...)
--       )
--     );
--
-- Realtime does not reliably evaluate join/subquery-based RLS policies against
-- other tables when deciding whether to deliver a change event (its RLS check
-- runs per-row off the WAL without the surrounding query context a normal
-- SELECT would have) — so INSERT events on `messages` are silently dropped for
-- everyone, and no badge ever fires. This is the same class of bug already
-- fixed for the `conversations` table in file 5 (open-queue broadcast); see
-- that file for the longer explanation.
--
-- Fix: same pattern — broadcast a small ping (bypasses RLS entirely) whenever
-- a message is inserted, and have the dashboards subscribe to that instead of
-- postgres_changes on messages. ChatWindow.jsx's own postgres_changes
-- subscription (filtered to a single, already-open conversation_id the agent
-- is a party to) is unaffected and left as-is — that one works fine because
-- the client is always on the correct side of the RLS check for their own
-- open ticket.
--
-- Safe to run multiple times.

create or replace function notify_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'message_id', new.id,
      'sender_id', new.sender_id
    ),
    'new_message',       -- event name
    'ticket-messages',   -- topic — all agents/seniors subscribe to this
    false                -- public topic: no Realtime Authorization policy needed to listen
  );
  return new;
end;
$$;

drop trigger if exists messages_broadcast on messages;
create trigger messages_broadcast
  after insert on messages
  for each row execute function notify_new_message();
