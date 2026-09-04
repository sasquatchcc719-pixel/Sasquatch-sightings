-- A service concern is an intake/review record, not an automatically approved
-- warranty visit. Customer replies and MMS evidence stay in the existing
-- conversation/media records and are linked here for one operational queue.

create table if not exists public.ops_service_concerns (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ops_customers(id) on delete restrict,
  appointment_id uuid references public.ops_appointments(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  status text not null default 'awaiting_customer'
    check (status in (
      'awaiting_customer',
      'ready_for_review',
      'approved_return',
      'resolved',
      'declined'
    )),
  category text not null default 'unclassified'
    check (category in (
      'unclassified',
      'visible_spot',
      'odor',
      'excess_moisture',
      'texture',
      'pricing',
      'technician',
      'damage',
      'other'
    )),
  source text not null default 'admin'
    check (source in ('admin', 'telegram_text', 'telegram_media')),
  initial_message text,
  internal_notes text,
  resolution_notes text,
  intake_sms_sent_at timestamptz,
  last_customer_message_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_service_concerns_customer_idx
  on public.ops_service_concerns (customer_id, created_at desc);
create index if not exists ops_service_concerns_appointment_idx
  on public.ops_service_concerns (appointment_id)
  where appointment_id is not null;
create index if not exists ops_service_concerns_conversation_idx
  on public.ops_service_concerns (conversation_id)
  where conversation_id is not null;
create index if not exists ops_service_concerns_open_queue_idx
  on public.ops_service_concerns (status, updated_at desc)
  where status in ('awaiting_customer', 'ready_for_review', 'approved_return');
create unique index if not exists ops_service_concerns_one_active_customer_idx
  on public.ops_service_concerns (customer_id)
  where status in ('awaiting_customer', 'ready_for_review', 'approved_return');

alter table public.ops_service_concerns enable row level security;

revoke all on table public.ops_service_concerns from anon;
grant select, insert, update on table public.ops_service_concerns to authenticated;
grant select, insert, update, delete on table public.ops_service_concerns to service_role;

drop policy if exists "ops_service_concerns_staff_read"
  on public.ops_service_concerns;
create policy "ops_service_concerns_staff_read"
  on public.ops_service_concerns
  for select
  to authenticated
  using (public.app_has_role(array['owner', 'dispatcher', 'tech']));

drop policy if exists "ops_service_concerns_staff_insert"
  on public.ops_service_concerns;
create policy "ops_service_concerns_staff_insert"
  on public.ops_service_concerns
  for insert
  to authenticated
  with check (public.app_has_role(array['owner', 'dispatcher']));

drop policy if exists "ops_service_concerns_staff_update"
  on public.ops_service_concerns;
create policy "ops_service_concerns_staff_update"
  on public.ops_service_concerns
  for update
  to authenticated
  using (public.app_has_role(array['owner', 'dispatcher']))
  with check (public.app_has_role(array['owner', 'dispatcher']));

alter table public.ops_customer_media
  add column if not exists service_concern_id uuid
  references public.ops_service_concerns(id) on delete set null;

create index if not exists ops_customer_media_service_concern_idx
  on public.ops_customer_media (service_concern_id, created_at)
  where service_concern_id is not null;

alter table public.ops_customer_media
  drop constraint if exists ops_customer_media_category_check;
alter table public.ops_customer_media
  add constraint ops_customer_media_category_check
  check (category in (
    'unclassified',
    'customer_file',
    'estimate',
    'job',
    'preexisting_damage',
    'service_concern'
  ));

comment on table public.ops_service_concerns is
  'Assessment-first customer service concerns; approved_return is an approval decision, not a scheduled appointment.';
comment on column public.ops_customer_media.service_concern_id is
  'Service concern that this private inbound attachment supports.';

-- The immediate review request stays. Replace the blanket promise with a
-- concrete intake request that gives staff evidence before a return is booked.
update public.ops_communication_templates
set body_template = 'Thanks {{first_name}}, we appreciate your business and hope you love the clean! If a spot remains once dry, reply with a wide photo, close-up and room so we can review it. For odor or excess moisture, just reply here. If you loved the results, a quick review means the world to us: sasquatchcarpet.com/reviews',
    updated_at = now()
where template_key = 'job_finished_sms';

update public.ops_communication_templates
set body_template = replace(
      body_template,
      'If anything is not 100% legendary, please text us at (719) 249-8791 and we will make it right.',
      'If anything is not 100% legendary after the carpet is fully dry, text us at (719) 249-8791. For a visible spot, include one wide photo, one close-up, and the room or area. For odor or excess moisture, tell us the exact area and how long it has been since service. We will review the original job and recommend the right next step.'
    ),
    updated_at = now()
where template_key = 'job_finished_email';

update public.ops_communication_templates
set body_template = replace(
      replace(
        body_template,
        'If a ring is still visible after that, give us a call and we''ll come back out to clear it — that follow-up is covered under our warranty, no charge.',
        'If a ring is still visible after that, text us one wide photo, one close-up, and the room or area. We will compare it with the original service and determine the right next step under our warranty.'
      ),
      'If anything is not 100% legendary, text us at (719) 249-8791 and we will make it right.',
      'If anything is not 100% legendary after the full 48-hour drying window, text us at (719) 249-8791. For a visible spot, include one wide photo, one close-up, and the room or area. If odor remains, tell us the exact area. We will review the original job and recommend the right next step.'
    ),
    updated_at = now()
where template_key = 'job_finished_email_urine';

-- This message duplicated both the issue invitation and the review ask.
update public.ops_communication_templates
set is_enabled = false,
    updated_at = now()
where template_key = 'satisfaction_checkin_email';

update public.ops_communication_queue
set status = 'cancelled',
    error_message = 'Cancelled when the redundant satisfaction check-in was retired',
    updated_at = now()
where template_key = 'satisfaction_checkin_email'
  and status = 'pending';
