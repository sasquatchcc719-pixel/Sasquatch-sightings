-- Gmail connector messages are imported evidence, separate from SMS and Resend sends.
create table public.ops_customer_email_history (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ops_customers(id) on delete cascade,
  mailbox text not null,
  message_id text not null,
  thread_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  occurred_at timestamptz not null,
  from_email text not null,
  to_email text not null,
  subject text not null,
  body_text text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid references auth.users(id),
  recorded_by_label text not null,
  unique (mailbox, message_id)
);
create index ops_customer_email_history_customer_idx
  on public.ops_customer_email_history(customer_id, occurred_at desc);
alter table public.ops_customer_email_history enable row level security;
revoke all on public.ops_customer_email_history from public, anon, authenticated;
grant select, insert on public.ops_customer_email_history to service_role;
