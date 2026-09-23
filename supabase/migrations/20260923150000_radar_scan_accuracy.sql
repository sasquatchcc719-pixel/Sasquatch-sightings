-- Make Radar misses explicit, and keep enough scan metadata to audit every
-- organic ranking. Legacy rows used rank_position = 50 as a fake "not found"
-- value; new scans store NULL so a genuine #50 remains a real rank.

alter table public.radar_rankings
  alter column rank_position drop not null;

comment on column public.radar_rankings.rank_position is
  'Organic SERP position (1-based). NULL means the domain was not found in the returned organic results.';

create table if not exists public.radar_scan_runs (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.radar_keywords(id) on delete cascade,
  provider text not null,
  device text not null,
  latitude numeric not null,
  longitude numeric not null,
  requested_depth integer not null check (requested_depth > 0),
  returned_depth integer not null check (returned_depth >= 0),
  provider_task_id text,
  provider_cost numeric,
  created_at timestamptz not null default now()
);

create index if not exists radar_scan_runs_keyword_created_idx
  on public.radar_scan_runs (keyword_id, created_at desc);

alter table public.radar_scan_runs enable row level security;

drop policy if exists "Authenticated can read radar_scan_runs"
  on public.radar_scan_runs;
create policy "Authenticated can read radar_scan_runs"
  on public.radar_scan_runs for select
  using (auth.role() = 'authenticated');

grant select on public.radar_scan_runs to authenticated;
grant all on public.radar_scan_runs to service_role;

alter table public.radar_rankings
  add column if not exists scan_run_id uuid
    references public.radar_scan_runs(id) on delete set null;

alter table public.radar_serp_snapshots
  add column if not exists scan_run_id uuid
    references public.radar_scan_runs(id) on delete cascade;

alter table public.radar_map_pack_snapshots
  add column if not exists scan_run_id uuid
    references public.radar_scan_runs(id) on delete cascade;

create index if not exists radar_rankings_scan_run_idx
  on public.radar_rankings (scan_run_id);
create index if not exists radar_serp_snapshots_scan_run_idx
  on public.radar_serp_snapshots (scan_run_id);
create index if not exists radar_map_pack_snapshots_scan_run_idx
  on public.radar_map_pack_snapshots (scan_run_id);
