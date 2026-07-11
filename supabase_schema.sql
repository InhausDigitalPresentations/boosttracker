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
-- ============================================================================

create extension if not exists pgcrypto;

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
-- ----------------------------------------------------------------------------
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#E7E9EE'
);

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
-- ROW LEVEL SECURITY
-- This app has no login — "anyone with the link" was the explicit choice —
-- so every table is fully readable/writable through the public anon key.
-- If you ever add authentication, this is exactly what to tighten.
-- ----------------------------------------------------------------------------
alter table clients enable row level security;
alter table team_members enable row level security;
alter table boosts enable row level security;
alter table archive enable row level security;

drop policy if exists "public read clients" on clients;
drop policy if exists "public write clients" on clients;
drop policy if exists "public update clients" on clients;
drop policy if exists "public delete clients" on clients;
create policy "public read clients" on clients for select using (true);
create policy "public write clients" on clients for insert with check (true);
create policy "public update clients" on clients for update using (true);
create policy "public delete clients" on clients for delete using (true);

drop policy if exists "public read team_members" on team_members;
drop policy if exists "public write team_members" on team_members;
drop policy if exists "public update team_members" on team_members;
drop policy if exists "public delete team_members" on team_members;
create policy "public read team_members" on team_members for select using (true);
create policy "public write team_members" on team_members for insert with check (true);
create policy "public update team_members" on team_members for update using (true);
create policy "public delete team_members" on team_members for delete using (true);

drop policy if exists "public read boosts" on boosts;
drop policy if exists "public write boosts" on boosts;
drop policy if exists "public update boosts" on boosts;
drop policy if exists "public delete boosts" on boosts;
create policy "public read boosts" on boosts for select using (true);
create policy "public write boosts" on boosts for insert with check (true);
create policy "public update boosts" on boosts for update using (true);
create policy "public delete boosts" on boosts for delete using (true);

drop policy if exists "public read archive" on archive;
drop policy if exists "public write archive" on archive;
drop policy if exists "public update archive" on archive;
drop policy if exists "public delete archive" on archive;
create policy "public read archive" on archive for select using (true);
create policy "public write archive" on archive for insert with check (true);
create policy "public update archive" on archive for update using (true);
create policy "public delete archive" on archive for delete using (true);

-- ----------------------------------------------------------------------------
-- DATA API GRANTS
-- RLS policies control which ROWS are visible; Postgres also needs the base
-- table-level permission granted before the anon key (what the browser uses,
-- since there's no login) can touch a table at all. Without this step you'd
-- see "permission denied" errors from the app even with the policies above.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on clients, team_members, boosts, archive to anon, authenticated;
grant execute on function close_month() to anon, authenticated;

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
