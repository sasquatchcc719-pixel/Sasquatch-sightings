-- Dedicated read credentials let a local display fetch only the box-truck
-- temperature. They cannot write telemetry or read other Sightings data.
create table public.fleet_temperature_display_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.fleet_temperature_display_tokens enable row level security;
revoke all on public.fleet_temperature_display_tokens from public, anon, authenticated;
revoke all on public.fleet_temperature_display_tokens from service_role;
grant select on public.fleet_temperature_display_tokens to service_role;
