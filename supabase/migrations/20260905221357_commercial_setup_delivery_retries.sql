-- Private outbox for repeatable delivery. Payload includes a short-lived auth
-- link, so no browser role (including signed-in staff) may access this table.
create table public.ops_commercial_setup_deliveries (
  operation_id uuid primary key,
  customer_id uuid not null references public.ops_customers(id) on delete cascade,
  contact_id uuid not null references public.ops_client_users(id) on delete cascade,
  agreement_id uuid not null references public.ops_commercial_agreements(id) on delete cascade,
  request_hash text not null,
  payload jsonb,
  resend_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on public.ops_commercial_setup_deliveries(customer_id);
create index on public.ops_commercial_setup_deliveries(contact_id);
create index on public.ops_commercial_setup_deliveries(agreement_id);
alter table public.ops_commercial_setup_deliveries enable row level security;
revoke all on public.ops_commercial_setup_deliveries from public, anon, authenticated;
grant all on public.ops_commercial_setup_deliveries to service_role;
