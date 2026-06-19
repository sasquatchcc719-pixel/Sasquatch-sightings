-- Tech expense receipts (e.g. gas) snapped from the tech portal.
-- Each row stores the receipt image plus the status of forwarding it to the
-- QuickBooks receipt-capture inbox (something@qbodocs.com) via email.
create table if not exists public.ops_tech_receipts (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid references public.staff_users(id) on delete set null,
  submitted_by_name text,
  storage_path text not null,
  public_url text not null,
  amount numeric(10, 2),
  note text,
  category text not null default 'gas',
  -- pending: saved, not yet forwarded. sent: emailed to QuickBooks inbox.
  -- failed: email send errored. no_destination: no QB inbox configured yet.
  status text not null default 'pending',
  qb_email text,
  resend_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ops_tech_receipts_staff_created
  on public.ops_tech_receipts (staff_user_id, created_at desc);

create index if not exists idx_ops_tech_receipts_created
  on public.ops_tech_receipts (created_at desc);

-- All access is via the service-role admin client (RLS bypassed). Enable RLS
-- with no policies so the table is not exposed to anon/authenticated clients.
alter table public.ops_tech_receipts enable row level security;
