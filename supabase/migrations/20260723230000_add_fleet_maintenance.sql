-- Fleet & maintenance (Module 2): asset profiles, daily meter check-ins,
-- interval-based maintenance rules, and the triggered task queue. Tasks are
-- born 'unassigned' — the daily cron creates them when a rule's interval is
-- reached, Telegram alerts Charles, and (Module 3) they'll appear in the
-- Unassigned Work Queue for drag-to-calendar scheduling.
-- RLS enabled with no policies: service-role (admin client) access only.

create table if not exists fleet_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_type text not null default 'van'
    check (asset_type in ('van', 'truck', 'truckmount', 'portable', 'tractor', 'tool', 'other')),
  meter_type text not null default 'miles'
    check (meter_type in ('miles', 'hours', 'none')),
  current_meter numeric,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists asset_meter_logs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references fleet_assets (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  reading numeric not null,
  logged_at timestamptz not null default now()
);

create table if not exists maintenance_rules (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references fleet_assets (id) on delete cascade,
  task_name text not null,
  interval_value numeric not null,
  interval_unit text not null default 'miles'
    check (interval_unit in ('miles', 'hours', 'days')),
  last_done_meter numeric,
  last_done_at timestamptz,
  est_duration_minutes int not null default 60,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references maintenance_rules (id) on delete set null,
  asset_id uuid not null references fleet_assets (id) on delete cascade,
  title text not null,
  status text not null default 'unassigned'
    check (status in ('unassigned', 'scheduled', 'completed', 'dismissed')),
  appointment_id uuid,
  meter_at_trigger numeric,
  triggered_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table fleet_assets enable row level security;
alter table asset_meter_logs enable row level security;
alter table maintenance_rules enable row level security;
alter table maintenance_tasks enable row level security;

create index if not exists idx_asset_meter_logs_asset
  on asset_meter_logs (asset_id, logged_at desc);
create index if not exists idx_maintenance_tasks_status
  on maintenance_tasks (status, triggered_at desc);
