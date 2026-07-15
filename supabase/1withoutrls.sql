-- ==========================================================
-- FILE A — SCHEMA / TABLES ONLY
-- Run this FIRST.
-- Supabase will show a 'Potential issue detected' RLS dialog
-- for these tables. Click 'Run without RLS' every time —
-- RLS + real policies are enabled explicitly in File B, so
-- Supabase's auto-RLS button is not needed here.
-- ==========================================================

-- =====================================================================
-- Nexline Support Desk — Telecom Support CRM (Employee Training Simulator)
-- schema.sql — tables, RLS policies, and RPC functions
-- Build once, in this order: extensions -> tables -> indexes -> functions
-- -> RLS -> realtime publication.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- =====================================================================
-- 1. ENUM TYPES
-- =====================================================================

create type user_role as enum ('admin', 'senior_agent', 'agent', 'customer');
create type agent_status as enum ('available', 'busy', 'break', 'offline');
create type ticket_priority as enum ('low', 'medium', 'high', 'urgent');
create type ticket_source as enum ('bot', 'human');
create type ticket_status as enum (
  'bot', 'open', 'assigned', 'active', 'on_hold',
  'escalated', 'pending', 'resolved', 'unresolved', 'cancelled', 'abandoned'
);
create type close_reason as enum (
  'resolved_first_contact', 'unresolved_closed', 'awaiting_customer', 'cancelled'
);
create type notification_type as enum (
  'new_queue_ticket', 'sla_breach_warning', 'customer_replied_idle',
  'escalation_assigned', 'escalation_returned', 'ticket_transferred'
);


-- =====================================================================
-- 2. CORE TABLES
-- =====================================================================

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  full_name text not null,
  status agent_status not null default 'offline',
  team_id uuid references teams(id) on delete set null,
  max_concurrent_tickets int not null default 3 check (max_concurrent_tickets > 0),
  created_at timestamptz not null default now()
);

create table issue_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  response_sla_minutes int not null check (response_sla_minutes > 0),
  resolution_sla_minutes int not null check (resolution_sla_minutes > 0),
  default_priority ticket_priority not null default 'medium',
  bot_script_id uuid, -- fk added after bot_scripts exists
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table bot_scripts (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references issue_categories(id) on delete cascade,
  greeting_text text not null,
  questions jsonb not null default '[]'::jsonb, -- [{text, quick_replies: []}]
  created_at timestamptz not null default now()
);

alter table issue_categories
  add constraint issue_categories_bot_script_fk
  foreign key (bot_script_id) references bot_scripts(id) on delete set null;

create table business_hours (
  id uuid primary key default gen_random_uuid(),
  day_of_week int not null check (day_of_week between 0 and 6), -- 0=Sunday
  open_time time not null,
  close_time time not null,
  timezone text not null default 'Asia/Kolkata',
  unique (day_of_week)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default ('TCK-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  client_id uuid not null references profiles(id),
  agent_id uuid references profiles(id),
  original_agent_id uuid references profiles(id),
  escalated_to uuid references profiles(id),
  category_id uuid references issue_categories(id),
  status ticket_status not null default 'bot',
  priority ticket_priority not null default 'medium',
  source ticket_source not null default 'bot',
  started_at timestamptz, -- set when it enters the human queue ('open')
  first_response_at timestamptz,
  claimed_at timestamptz,
  closed_at timestamptz,
  hold_started_at timestamptz,
  hold_total_seconds int not null default 0,
  reopened_count int not null default 0,
  close_reason close_reason,
  csat_score int check (csat_score between 1 and 5),
  csat_prompted boolean not null default false,
  outside_business_hours boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Duplicate ticket prevention (§6.10): only one non-terminal ticket per customer
create unique index conversations_one_active_per_customer
  on conversations (client_id)
  where status in ('bot','open','assigned','active','on_hold','escalated','pending');

create index conversations_queue_idx on conversations (status, priority, started_at)
  where status = 'open';
create index conversations_agent_idx on conversations (agent_id, status);
create index conversations_client_idx on conversations (client_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  sender_role user_role not null,
  body text not null,
  attachment_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index messages_conversation_idx on messages (conversation_id, created_at);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  file_url text not null,
  file_type text,
  file_size int,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

alter table messages
  add constraint messages_attachment_fk
  foreign key (attachment_id) references attachments(id) on delete set null;

create table internal_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index internal_notes_conversation_idx on internal_notes (conversation_id);

create table escalations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  from_agent_id uuid not null references profiles(id),
  to_agent_id uuid references profiles(id),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table transfers (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  from_agent_id uuid not null references profiles(id),
  to_agent_id uuid not null references profiles(id),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

create table qa_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  reviewer_id uuid not null references profiles(id),
  coaching_score int not null check (coaching_score between 1 and 5),
  notes text,
  chat_quality_auto_score numeric(3,1),
  created_at timestamptz not null default now()
);

create table time_logs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references profiles(id),
  status agent_status not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint time_logs_valid_range check (ended_at is null or ended_at > started_at)
);

-- No overlapping open segments per agent (§5 time_logs).
-- Partial unique index guarantees at most one open (ended_at is null) segment per agent;
-- the exclusion constraint below guards against overlapping *closed* ranges too.
create unique index time_logs_one_open_segment
  on time_logs (agent_id) where ended_at is null;

alter table time_logs
  add constraint time_logs_no_overlap
  exclude using gist (
    agent_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz)) with &&
  );

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references conversations(id) on delete set null,
  actor_id uuid references profiles(id),
  action text not null,
  from_status ticket_status,
  to_status ticket_status,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_ticket_idx on audit_log (ticket_id, created_at);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type notification_type not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, read_at);


-- ai_knowledge table (RLS enabled later, in File B)
create table ai_knowledge (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references issue_categories(id) on delete set null,
  question text not null check (length(trim(question)) > 0),
  answer text not null check (length(trim(answer)) > 0),
  keywords text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_knowledge_category_idx on ai_knowledge (category_id);