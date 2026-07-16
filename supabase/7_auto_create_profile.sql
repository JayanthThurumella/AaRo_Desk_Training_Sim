-- ==========================================================
-- FILE — AUTO-CREATE PROFILE ON NEW AUTH USER
-- Run this AFTER files 1-6.
--
-- Whenever a new row is inserted into auth.users (e.g. via the Supabase
-- Studio "Add user" button, or your own sign-up flow), this trigger
-- inserts a matching row into public.profiles automatically, so you never
-- get a user with no profile (which would otherwise break every RLS
-- policy / current_role_of() lookup for them).
--
-- Default role is 'agent' (change p_default_role below if you'd rather
-- default to something else, e.g. 'customer' for a public sign-up form).
-- full_name is pulled from the auth user's metadata if the client set it
-- (raw_user_meta_data->>'full_name'), otherwise falls back to the part of
-- their email before the @, otherwise 'New User' — profiles.full_name is
-- not-null, so it always needs a value.
-- ==========================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    'agent', -- default role for anyone created straight from Supabase Auth
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1),
      'New User'
    )
  )
  on conflict (id) do nothing; -- safety net if a profile row already exists
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
