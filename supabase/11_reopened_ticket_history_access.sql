-- =====================================================================
-- 11. Reopened ticket history access for staff
-- =====================================================================
-- When a customer reopens a resolved/unresolved/abandoned ticket,
-- reopen_ticket_new_session() (file 8) creates a brand-new conversation
-- row and links it back to the old one via parent_conversation_id. The
-- customer can browse that old conversation from their own History list,
-- but the existing RLS policies only let an agent/senior agent read a
-- conversation (and its messages / internal notes) they are themselves
-- assigned to — so whoever picks up the new ticket had no way to see how
-- the issue was originally handled, even though the two tickets are the
-- same underlying case.
--
-- These policies add read access to a conversation's PARENT record (and
-- that parent's messages / internal notes) for whichever staff member is
-- currently assigned to (or escalated on) the child ticket. They're
-- additive (permissive) policies, so they only ever grant more read
-- access — nothing already allowed by the policies in file 2 is affected.
--
-- IMPORTANT: the "is this uid assigned to a child of this conversation"
-- check must NOT be done as a plain correlated subquery against
-- `conversations` inside a policy that is itself declared on
-- `conversations` — Postgres has to re-apply that same policy to
-- evaluate the inner scan, which recurses until it errors out
-- ("infinite recursion detected in policy for relation conversations",
-- surfaced by PostgREST as a plain 500). Routing the lookup through a
-- `security definer` function avoids this: the function's internal
-- query runs with the privileges of its owner and doesn't re-trigger
-- RLS, the same way claim_conversation/escalate_conversation/etc. in
-- file 2 already bypass RLS to do their own checks.

create or replace function is_assigned_to_child_of(p_parent_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversations child
    where child.parent_conversation_id = p_parent_id
      and (child.agent_id = p_uid or child.escalated_to = p_uid)
  );
$$;

create policy conversations_select_parent_for_staff on conversations for select
  using (
    is_staff(auth.uid()) and is_assigned_to_child_of(conversations.id, auth.uid())
  );

create policy messages_select_parent_for_staff on messages for select
  using (
    is_assigned_to_child_of(messages.conversation_id, auth.uid())
  );

create policy internal_notes_select_parent_for_staff on internal_notes for select
  using (
    is_staff(auth.uid()) and is_assigned_to_child_of(internal_notes.conversation_id, auth.uid())
  );