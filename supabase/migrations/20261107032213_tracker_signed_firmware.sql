-- Firmware is private and targeted explicitly; device APIs use the existing bearer identity.
create table public.fleet_firmware_releases (
  id uuid primary key default gen_random_uuid(),
  sequence bigint unique not null check (sequence between 1 and 2147483647),
  version text not null check (length(version) between 1 and 64),
  board text not null check (board = 'ESP32-S3-SIM7670G-4G-V2'),
  size integer not null check (size between 1 and 3145728),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  signature text not null check (length(signature) between 80 and 104),
  storage_path text unique not null,
  created_at timestamptz not null default now()
);
create table public.fleet_tracker_firmware (
  tracker_id uuid primary key references public.fleet_trackers(id) on delete cascade,
  release_id uuid references public.fleet_firmware_releases(id),
  reported_version text,
  reported_sequence bigint,
  state text check (state in ('ready','installing','pending','confirmed','rolled_back','rejected','download_failed')),
  updated_at timestamptz not null default now()
);
alter table public.fleet_firmware_releases enable row level security;
alter table public.fleet_tracker_firmware enable row level security;
revoke all on public.fleet_firmware_releases, public.fleet_tracker_firmware from public, anon, authenticated;
grant all on public.fleet_firmware_releases, public.fleet_tracker_firmware to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tracker-firmware', 'tracker-firmware', false, 3145728, array['application/octet-stream']);
