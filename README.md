# Nexline Support Desk — Telecom Support CRM (Employee Training Simulator)

A realtime telecom customer-support simulator: customers open tickets through
a scripted bot and can escalate to a human queue; agents claim, work, hold,
escalate, transfer, and close tickets; senior agents own escalations and QA
review; admins configure categories/SLAs, manage roles, and see org-wide KPIs.

Built with React + Vite + Tailwind v4 on the frontend, and Supabase
(Postgres + Auth + Realtime + Row Level Security) on the backend. All state
transitions are enforced by security-definer Postgres functions (see
`supabase/schema.sql`) so the rules hold even if the UI is bypassed.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the entire contents of `supabase/schema.sql`. It
   creates all tables, RLS policies, RPC functions, enables Realtime on every
   table, and seeds five issue categories with bot scripts and default
   business hours.
3. In **Authentication → Providers**, email/password is enabled by default —
   nothing else to configure for local testing. (Turn off "Confirm email" in
   **Authentication → Settings** if you want to sign in immediately after
   sign-up during testing.)
4. Copy your project URL and anon public key from **Project Settings → API**.

## 2. Configure the frontend

```bash
cp .env.example .env
# then edit .env with your Supabase URL + anon key
npm install
npm run dev
```

## 3. Create your first users

New sign-ups (via the app's "Create account" tab) always land in the
`customer` role. To test the staff views:

1. Sign up 2-3 accounts through the app (these will be your agent, senior
   agent, and admin test users).
2. In the Supabase SQL Editor, promote them:

```sql
update profiles set role = 'admin'         where id = '<user-uuid>';
update profiles set role = 'senior_agent'  where id = '<user-uuid>';
update profiles set role = 'agent'         where id = '<user-uuid>';
```

3. Sign in as each — you'll land on `/admin`, `/senior`, or `/agent`
   automatically based on role. Agents and senior agents start `offline`;
   use the presence switcher in the header to go `Available` before claiming
   queue tickets.
4. Sign in as a plain customer account (or sign up a fresh one) to walk the
   bot flow at `/support` and escalate into the queue.

## How the pieces fit together

- **`supabase/schema.sql`** — the single source of truth for data model,
  RLS, and ticket-lifecycle rules. Every consequential mutation (claim,
  hold/resume, escalate, transfer, close, reopen, presence changes) goes
  through a `security definer` RPC that re-checks the caller's role and the
  ticket's current state before touching anything — the frontend calls these
  RPCs and never mutates ticket status columns directly.
- **`src/utils/kpi.js`** — pure functions for every metric shown on the
  agent, senior, and admin dashboards (first response time, handle time,
  FCR, escalation/reopen/abandonment rates, CSAT, utilization, an auto
  chat-quality score). Dashboards only ever import from here, so the
  definitions can't drift between views.
- **`src/contexts/AuthContext.jsx`** — session + profile (role, presence)
  loaded once and kept live via a Realtime subscription.
- **`src/pages/customer/`** — category picker → scripted bot → live queue
  chat → CSAT prompt.
- **`src/pages/agent/`**, **`src/pages/senior/`**, **`src/pages/admin/`** —
  role dashboards, all built from shared components in `src/components/`
  (`ChatWindow`, `TicketDetailPanel`, `TicketActions`, `QueueList`,
  `InternalNotes`, `QaReviewPanel`, `KpiStrip`, `PresenceSwitcher`,
  `NotificationsBell`).

## Training-only improvements

A few admin-side additions aimed at making this better for training and coaching, without adding enterprise complexity:

- **Conversation review** (`Admin → Conversations`) — admin can browse only completed
  chats (Resolved / Unresolved / Cancelled / Abandoned), open the full read-only
  transcript and internal notes, and leave a coaching / QA review. Admin cannot
  see or join live chats — RLS still governs this, this is a read-only UI on
  top of the same `conversations_select_admin` policy the Overview tab already used.
- **Categories, SLAs & AI Knowledge** (`Admin → Categories & SLAs`,
  `Admin → AI Knowledge`) — admin can now create and delete categories (not just
  edit SLAs/priority on existing ones), and manage a simple AI Q&A knowledge base
  (`ai_knowledge` table). The customer-facing bot (`src/pages/customer/BotChat.jsx`)
  searches this table first via a lightweight keyword-overlap match
  (`src/utils/aiKnowledge.js`) when a customer types a free-text question, before
  falling back to the scripted flow or a human agent. Ten default telecom
  categories are seeded (Billing, Network Issue, SIM Activation, Roaming, Data
  Pack, Recharge, Device Settings, VAS, Number Portability, Complaint), each with
  a couple of starter Q&A entries — more can be added anytime from the UI.
- **Individual KPI & Reports** (`Admin → Reports`) — pick any agent or senior
  agent and see their KPIs (Total Chats Handled, Chats Resolved, FRT, AHT,
  Resolution Time, SLA Met %, SLA Breached, Escalation Rate, FCR, Reopened
  Tickets, CSAT, Average Customer Wait Time) with a date filter (Today,
  Yesterday, Last 7 Days, This Month, Custom). All figures reuse the same pure
  functions in `src/utils/kpi.js` as the rest of the app.
- **KPI Help** (`Admin → KPI Help`) — a plain-language explanation of every
  metric with its calculation, for onboarding new admins/trainers.

## Notes on the design

Functional agent-desk aesthetic rather than a marketing look: a muted
paper/ink base, one deep teal brand color, and dedicated colors per ticket
status so queue health is readable at a glance. Ticket numbers, timers, and
every other data value use a monospace face to stay scannable in a dense
table. The signal-bar mark in the header is the one recurring signature
element, tying back to "telecom" without leaning on a literal phone icon.
