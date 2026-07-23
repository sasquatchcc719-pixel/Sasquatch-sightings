-- Door-hanger canvassing GPS tracker (separate from gps_shifts/timesheets —
-- canvassing is paid busy-work between jobs; it must never create payroll
-- records). Sessions are walk routes; points are the breadcrumb trail.
-- Coverage map shades the walked corridor with a date label so nobody
-- re-canvasses a neighborhood the other person already hit.
-- RLS enabled with no policies: service-role (admin client) access only.

create table if not exists canvass_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'completed', 'discarded')),
  point_count int not null default 0,
  distance_m numeric,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists canvass_points (
  id bigint generated always as identity primary key,
  session_id uuid not null references canvass_sessions (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m real,
  speed_mps real,
  recorded_at timestamptz not null
);

alter table canvass_sessions enable row level security;
alter table canvass_points enable row level security;

create index if not exists idx_canvass_points_session
  on canvass_points (session_id, recorded_at);
create index if not exists idx_canvass_sessions_user_started
  on canvass_sessions (user_id, started_at desc);
