-- ============================================================================
-- INHAUS BOOST TRACKER — SUPABASE SCHEMA
-- ============================================================================
-- Run this ONCE in your Supabase project: Dashboard > SQL Editor > New query,
-- paste this whole file, click Run. Safe to re-run — every statement is
-- written to be idempotent.
--
-- Tables: clients, team_members, boosts, archive
-- Function: close_month() — the "Close Month" button calls this as one
--           atomic transaction (all clients archived + reset together, or
--           none are, if something fails partway through).
-- Auth: only @inhaus.ae emails can sign up (enforced server-side via a
--       Before User Created hook), and only logged-in users can read/write
--       any data at all. See the hook_restrict_signup_domain function below,
--       and SETUP.md for the one manual dashboard step needed to wire it up.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- CLIENTS
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  monthly_budget integer not null default 0,
  active_month text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- TEAM MEMBERS
-- One row per person who has ever logged in — see the "AUTO-PROVISION TEAM
-- MEMBERS" trigger below. There is no manual "Add Team Member" anymore:
-- signing up with an @inhaus.ae account IS what creates the row, so the
-- assignment list always matches who can actually receive a notification.
-- ----------------------------------------------------------------------------
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#E7E9EE'
);

-- Added when the login feature shipped — ADD COLUMN IF NOT EXISTS instead of
-- being part of CREATE TABLE, so this still works on a project that already
-- has a team_members table from before.
alter table team_members add column if not exists user_id uuid unique references auth.users(id) on delete cascade;
alter table team_members add column if not exists email text;

-- ----------------------------------------------------------------------------
-- BOOSTS
-- end_date is computed automatically by Postgres from start_date + duration,
-- so nothing in the app ever has to (re)calculate it by hand.
-- ----------------------------------------------------------------------------
create table if not exists boosts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  month text not null,
  platform text not null,
  post_link text not null,
  objective text not null,
  budget integer not null default 0,
  start_date date not null,
  duration integer not null default 1,
  end_date date generated always as ((start_date + (duration - 1) * interval '1 day')::date) stored,
  assigned_to uuid references team_members(id) on delete set null,
  status text not null default 'To Do' check (status in ('To Do','In Progress','Boosted','Completed','Cancelled')),
  priority text not null default 'Normal' check (priority in ('Normal','Urgent')),
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ARCHIVE
-- client_id is intentionally NOT a foreign key: archived months must survive
-- even after the client itself is later deleted (client_name is stored
-- separately for exactly this reason).
-- ----------------------------------------------------------------------------
create table if not exists archive (
  id uuid primary key default gen_random_uuid(),
  client_id uuid,
  client_name text not null,
  month text not null,
  monthly_budget integer not null default 0,
  allocated_budget integer not null default 0,
  remaining_budget integer not null default 0,
  num_boosts integer not null default 0,
  invoice_status text not null default 'Pending' check (invoice_status in ('Pending','Invoiced','Paid')),
  invoice_number text not null default '',
  invoice_date date,
  boosts_snapshot jsonb not null default '[]'::jsonb,
  closed_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- NOTIFICATION LOG — a lightweight audit trail so you can tell whether an
-- assignment email actually went out, without digging through Postgres logs.
-- Not shown anywhere in the UI yet; query it directly in the Table Editor.
-- ----------------------------------------------------------------------------
create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  boost_id uuid references boosts(id) on delete cascade,
  team_member_id uuid references team_members(id) on delete set null,
  event_type text not null,
  subject text,
  sent_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- AUTO-PROVISION TEAM MEMBERS FROM LOGIN
-- Fires right after a new @inhaus.ae account is created (i.e. right after
-- the "Before User Created" hook has already let the signup through). Turns
-- their email into a display name ("agus.castellani@inhaus.ae" ->
-- "Agus Castellani") and gives them a deterministic avatar color so the same
-- person always gets the same color. Both are editable afterwards from
-- Settings.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived_name text;
  palette text[] := array['#F886FE','#7DD3FC','#C4B5FD','#86EFAC','#FCA5A5','#FDBA74','#A5B4FC','#F9A8D4'];
  chosen_color text;
begin
  derived_name := initcap(replace(replace(split_part(new.email, '@', 1), '.', ' '), '_', ' '));
  chosen_color := palette[1 + (abs(hashtext(new.email)) % array_length(palette, 1))];

  insert into public.team_members (user_id, email, name, color)
  values (new.id, new.email, derived_name, chosen_color)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_team_member();

-- ----------------------------------------------------------------------------
-- CLOSE MONTH — one atomic transaction: archive every client's current month,
-- wipe their active boosts, roll them all forward to the next month.
-- ----------------------------------------------------------------------------
create or replace function close_month()
returns void
language plpgsql
as $$
declare
  c record;
  v_allocated integer;
  v_num_boosts integer;
  v_snapshot jsonb;
begin
  for c in select * from clients loop
    select coalesce(sum(budget), 0), count(*), coalesce(jsonb_agg(to_jsonb(b) order by b.created_at), '[]'::jsonb)
      into v_allocated, v_num_boosts, v_snapshot
      from boosts b
      where b.client_id = c.id and b.month = c.active_month;

    insert into archive (client_id, client_name, month, monthly_budget, allocated_budget, remaining_budget, num_boosts, boosts_snapshot)
    values (c.id, c.name, c.active_month, c.monthly_budget, v_allocated, c.monthly_budget - v_allocated, v_num_boosts, v_snapshot);

    delete from boosts where client_id = c.id and month = c.active_month;

    update clients
      set active_month = to_char((to_date(c.active_month || '-01', 'YYYY-MM-DD') + interval '1 month'), 'YYYY-MM')
      where id = c.id;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- SIGNUP RESTRICTION — only @inhaus.ae addresses may create an account.
-- This is enforced server-side via Supabase's "Before User Created" Auth
-- Hook, NOT just a frontend check, so it can't be bypassed by calling the
-- signup API directly. Change ALLOWED_DOMAIN below if the company domain
-- is ever different.
--
-- IMPORTANT: creating this function does not turn it on by itself — you
-- still need to wire it up once in the dashboard: Authentication > Hooks >
-- "Before User Created" > Postgres function > pick
-- hook_restrict_signup_domain. See SETUP.md.
-- ----------------------------------------------------------------------------
create or replace function public.hook_restrict_signup_domain(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  allowed_domain text := 'inhaus.ae';
  email text;
  domain text;
begin
  email := event->'user'->>'email';
  domain := lower(split_part(coalesce(email, ''), '@', 2));

  if domain <> allowed_domain then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'Only @' || allowed_domain || ' email addresses can create an account.',
        'http_code', 403
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_restrict_signup_domain to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_domain from authenticated, anon, public;

-- ----------------------------------------------------------------------------
-- ASSIGNMENT / STATUS-CHANGE EMAIL NOTIFICATIONS
-- Fires on every insert/update to boosts. Sends an email via Resend's API
-- (through pg_net, so it doesn't block the save) when:
--   (a) a boost is newly assigned to someone, or
--   (b) an already-assigned boost's status changes.
-- The Resend API key is read from Vault, never hardcoded here — see
-- SETUP.md for the one-time step that stores it as 'resend_api_key'.
-- If that secret hasn't been created yet, this quietly does nothing (no
-- error, no broken saves) — assigning/editing boosts always works even
-- before notifications are configured.
--
-- IMPORTANT: change the 'from' address below once you've verified a
-- sending domain in Resend (see SETUP.md) — until then it will fail to
-- actually deliver to anyone but your own Resend account email.
-- ----------------------------------------------------------------------------
create or replace function public.notify_boost_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member record;
  client_name text;
  api_key text;
  is_new_assignment boolean := false;
  is_status_change boolean := false;
  email_subject text;
  email_html text;
begin
  if tg_op = 'INSERT' then
    is_new_assignment := new.assigned_to is not null;
  elsif tg_op = 'UPDATE' then
    is_new_assignment := new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to;
    is_status_change := new.assigned_to is not null and new.status is distinct from old.status and not is_new_assignment;
  end if;

  if not (is_new_assignment or is_status_change) then
    return new;
  end if;

  select * into member from public.team_members where id = new.assigned_to;
  if not found or member.email is null then
    return new;
  end if;

  select name into client_name from public.clients where id = new.client_id;

  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if api_key is null then
    return new; -- notifications not configured yet — fail silently, don't block the save
  end if;

  if is_new_assignment then
    email_subject := 'New boost assigned — ' || coalesce(client_name, 'a client');
    email_html :=
      '<p>Hi ' || coalesce(member.name, 'there') || ',</p>' ||
      '<p>You''ve been assigned a new boost task for <strong>' || coalesce(client_name, 'a client') || '</strong>.</p>' ||
      '<p>Platform: ' || coalesce(new.platform, '—') ||
      '<br/>Budget: AED ' || coalesce(new.budget::text, '—') ||
      '<br/>Start date: ' || coalesce(new.start_date::text, '—') ||
      '<br/>Duration: ' || coalesce(new.duration::text, '—') || ' days</p>' ||
      '<p><a href="' || coalesce(new.post_link, '#') || '">View the post</a></p>';
  else
    email_subject := 'Boost status updated — ' || coalesce(client_name, 'a client') || ' is now "' || coalesce(new.status, '') || '"';
    email_html :=
      '<p>Hi ' || coalesce(member.name, 'there') || ',</p>' ||
      '<p>One of your assigned boosts for <strong>' || coalesce(client_name, 'a client') || '</strong> changed status to <strong>' || coalesce(new.status, '') || '</strong>.</p>';
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || api_key),
    body := jsonb_build_object(
      'from', 'Inhaus Boost Tracker <notifications@inhaus.ae>',
      'to', jsonb_build_array(member.email),
      'subject', email_subject,
      'html', email_html
    )
  );

  insert into public.notification_log (boost_id, team_member_id, event_type, subject)
  values (new.id, member.id, case when is_new_assignment then 'assigned' else 'status_changed' end, email_subject);

  return new;
end;
$$;

drop trigger if exists on_boost_notify on boosts;
create trigger on_boost_notify
  after insert or update on boosts
  for each row execute function public.notify_boost_assignment();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Only logged-in users (any @inhaus.ae account that signed up) can read or
-- write anything — there is no public/anon access to this data anymore.
-- ----------------------------------------------------------------------------
alter table clients enable row level security;
alter table team_members enable row level security;
alter table boosts enable row level security;
alter table archive enable row level security;
alter table notification_log enable row level security; -- no policies on purpose: nobody reads this from the app; check it in the Table Editor instead.

drop policy if exists "public read clients" on clients;
drop policy if exists "public write clients" on clients;
drop policy if exists "public update clients" on clients;
drop policy if exists "public delete clients" on clients;
drop policy if exists "authenticated read clients" on clients;
drop policy if exists "authenticated write clients" on clients;
drop policy if exists "authenticated update clients" on clients;
drop policy if exists "authenticated delete clients" on clients;
create policy "authenticated read clients" on clients for select to authenticated using (true);
create policy "authenticated write clients" on clients for insert to authenticated with check (true);
create policy "authenticated update clients" on clients for update to authenticated using (true);
create policy "authenticated delete clients" on clients for delete to authenticated using (true);

-- team_members rows are now created by the on_auth_user_created trigger
-- (which runs as the function owner and bypasses RLS), not by the app, so
-- there's intentionally no INSERT or DELETE policy for `authenticated` here
-- anymore — only read (for the assignment dropdown) and update (to fix a
-- name or change an avatar color from Settings).
drop policy if exists "public read team_members" on team_members;
drop policy if exists "public write team_members" on team_members;
drop policy if exists "public update team_members" on team_members;
drop policy if exists "public delete team_members" on team_members;
drop policy if exists "authenticated read team_members" on team_members;
drop policy if exists "authenticated write team_members" on team_members;
drop policy if exists "authenticated update team_members" on team_members;
drop policy if exists "authenticated delete team_members" on team_members;
create policy "authenticated read team_members" on team_members for select to authenticated using (true);
create policy "authenticated update team_members" on team_members for update to authenticated using (true);

drop policy if exists "public read boosts" on boosts;
drop policy if exists "public write boosts" on boosts;
drop policy if exists "public update boosts" on boosts;
drop policy if exists "public delete boosts" on boosts;
drop policy if exists "authenticated read boosts" on boosts;
drop policy if exists "authenticated write boosts" on boosts;
drop policy if exists "authenticated update boosts" on boosts;
drop policy if exists "authenticated delete boosts" on boosts;
create policy "authenticated read boosts" on boosts for select to authenticated using (true);
create policy "authenticated write boosts" on boosts for insert to authenticated with check (true);
create policy "authenticated update boosts" on boosts for update to authenticated using (true);
create policy "authenticated delete boosts" on boosts for delete to authenticated using (true);

drop policy if exists "public read archive" on archive;
drop policy if exists "public write archive" on archive;
drop policy if exists "public update archive" on archive;
drop policy if exists "public delete archive" on archive;
drop policy if exists "authenticated read archive" on archive;
drop policy if exists "authenticated write archive" on archive;
drop policy if exists "authenticated update archive" on archive;
drop policy if exists "authenticated delete archive" on archive;
create policy "authenticated read archive" on archive for select to authenticated using (true);
create policy "authenticated write archive" on archive for insert to authenticated with check (true);
create policy "authenticated update archive" on archive for update to authenticated using (true);
create policy "authenticated delete archive" on archive for delete to authenticated using (true);

-- ----------------------------------------------------------------------------
-- DATA API GRANTS
-- RLS policies control which ROWS are visible; Postgres also needs the base
-- table-level permission granted before any request can touch a table at
-- all. Access is granted to `authenticated` only now — `anon` is explicitly
-- revoked, so a logged-out visitor can't read or write anything, even
-- though the anon key is technically public.
-- ----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on clients, boosts, archive to authenticated;
grant select, update on team_members to authenticated; -- no insert/delete: rows come from login, not the app
revoke insert, delete on team_members from authenticated; -- explicit, in case this ran before with the old broader grant
grant execute on function close_month() to authenticated;

revoke select, insert, update, delete on clients, team_members, boosts, archive from anon;
revoke execute on function close_month() from anon;
revoke all on notification_log from authenticated, anon;

-- ----------------------------------------------------------------------------
-- REALTIME — lets the app subscribe to live changes instead of only polling.
-- These two statements error harmlessly if a table is already in the
-- publication, which is why they're wrapped to stay re-run-safe.
-- ----------------------------------------------------------------------------
do $$
begin
  execute 'alter publication supabase_realtime add table clients';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'alter publication supabase_realtime add table team_members';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'alter publication supabase_realtime add table boosts';
exception when duplicate_object then null;
end $$;

do $$
begin
  execute 'alter publication supabase_realtime add table archive';
exception when duplicate_object then null;
end $$;
