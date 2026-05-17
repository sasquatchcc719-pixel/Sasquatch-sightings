create table if not exists blacklist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  reason text,
  created_at timestamptz not null default now()
);

create unique index blacklist_phone_idx on blacklist (phone);

comment on table blacklist is 'Customers blocked from calling or booking.';
