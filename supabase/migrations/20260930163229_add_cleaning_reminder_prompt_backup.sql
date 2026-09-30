-- Durable fallback for the invoice reminder buttons. If staff do not set a
-- reminder while closing the job, the customer gets a separate preference
-- question at least 30 minutes after the review request (or completion when no
-- review request is sent). Replies are handled by the existing Twilio webhook.
create table if not exists public.cleaning_reminder_prompts (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.ops_appointments(id) on delete cascade,
  customer_id uuid references public.ops_customers(id) on delete set null,
  phone text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'accepted', 'declined', 'skipped', 'failed')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  responded_at timestamptz,
  selected_interval_months integer check (selected_interval_months in (3, 6, 12)),
  inbound_message_sid text,
  response_text text,
  message text,
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cleaning_reminder_prompts_due_idx
  on public.cleaning_reminder_prompts (status, scheduled_for);
create index if not exists cleaning_reminder_prompts_phone_idx
  on public.cleaning_reminder_prompts (phone, status, sent_at desc);
create index if not exists cleaning_reminder_prompts_customer_idx
  on public.cleaning_reminder_prompts (customer_id);

alter table public.cleaning_reminder_prompts enable row level security;

create policy "Service role full access" on public.cleaning_reminder_prompts
  for all to service_role using (true) with check (true);

grant select, insert, update, delete
  on table public.cleaning_reminder_prompts to service_role;

alter table public.cleaning_reminders
  add column if not exists source text not null default 'staff_invoice'
    check (source in ('staff_invoice', 'customer_sms'));
