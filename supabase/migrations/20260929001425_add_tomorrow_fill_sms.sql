-- Deterministic, owner-approved SMS route-fill campaigns.
-- All campaign data is server-only; public booking links are resolved through
-- a narrow route that validates the opaque recipient token.

create table if not exists public.tomorrow_fill_settings (
  id boolean primary key default true check (id),
  engine_enabled boolean not null default true,
  send_enabled boolean not null default false,
  dormancy_months integer not null default 8 check (dormancy_months between 1 and 36),
  customer_cooldown_days integer not null default 14 check (customer_cooldown_days between 1 and 365),
  unanswered_limit integer not null default 4 check (unanswered_limit between 1 and 20),
  rest_days integer not null default 60 check (rest_days between 1 and 365),
  minimum_audience_size integer not null default 5 check (minimum_audience_size between 1 and 500),
  default_wave_size integer not null default 5 check (default_wave_size between 1 and 100),
  max_discounted_bookings integer not null default 2 check (max_discounted_bookings between 1 and 20),
  offer_code text not null default 'TF35',
  offer_amount numeric(10,2) not null default 35 check (offer_amount >= 0),
  minimum_subtotal numeric(10,2) not null default 250 check (minimum_subtotal >= 0),
  offer_valid_days integer not null default 14 check (offer_valid_days between 1 and 60),
  message_template text not null default 'Hi {{first_name}}, Sasquatch Carpet Cleaning has an opening in your area tomorrow. Save ${{offer_amount}} on a cleaning of ${{minimum_subtotal}} or more. See available times: {{booking_url}} Reply STOP to opt out.',
  updated_at timestamptz not null default now()
);

alter table public.tomorrow_fill_settings
  alter column message_template set default 'Hi {{first_name}}, Sasquatch Carpet Cleaning has an opening in your area tomorrow. Save ${{offer_amount}} on a cleaning of ${{minimum_subtotal}} or more. See available times: {{booking_url}} Reply STOP to opt out.',
  alter column default_wave_size set default 5;

insert into public.tomorrow_fill_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.sms_marketing_consents (
  customer_id uuid primary key references public.ops_customers(id) on delete cascade,
  phone_normalized text not null,
  status text not null default 'opted_in'
    check (status in ('opted_in', 'opted_out', 'unknown')),
  source text not null default 'existing_customer_terms',
  disclosure text,
  consented_at timestamptz,
  opted_out_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_sms_marketing_consents_phone
  on public.sms_marketing_consents (phone_normalized);

create table if not exists public.tomorrow_fill_campaigns (
  id uuid primary key default gen_random_uuid(),
  target_date date not null,
  status text not null default 'preview'
    check (status in ('preview', 'pending_approval', 'sending', 'active', 'filled', 'skipped', 'expired', 'failed')),
  selected_zips text[] not null default '{}',
  openings jsonb not null default '[]'::jsonb,
  exclusion_counts jsonb not null default '{}'::jsonb,
  open_minutes integer not null default 0 check (open_minutes >= 0),
  booked_minutes integer not null default 0 check (booked_minutes >= 0),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  selected_count integer not null default 0 check (selected_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  booked_count integer not null default 0 check (booked_count >= 0),
  attributed_revenue numeric(12,2) not null default 0,
  max_discounted_bookings integer not null default 2 check (max_discounted_bookings > 0),
  offer_code text not null,
  offer_amount numeric(10,2) not null,
  minimum_subtotal numeric(10,2) not null,
  message_template text not null,
  telegram_chat_id text,
  telegram_message_id text,
  approved_at timestamptz,
  approved_by text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_date)
);

create index if not exists idx_tomorrow_fill_campaigns_status_target
  on public.tomorrow_fill_campaigns (status, target_date desc);

create table if not exists public.tomorrow_fill_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.tomorrow_fill_campaigns(id) on delete cascade,
  customer_id uuid not null references public.ops_customers(id) on delete cascade,
  service_address_id uuid references public.ops_service_addresses(id) on delete set null,
  appointment_id uuid references public.ops_appointments(id) on delete set null,
  booking_token uuid not null default gen_random_uuid() unique,
  phone_normalized text not null,
  zip_code text not null,
  last_clean_date date not null,
  lifetime_value numeric(12,2) not null default 0,
  rank integer not null,
  status text not null default 'eligible'
    check (status in ('eligible', 'selected', 'sent', 'clicked', 'replied', 'claiming', 'booked', 'failed', 'skipped', 'suppressed')),
  exclusion_reason text,
  twilio_sid text,
  message_body text,
  last_contacted_at timestamptz,
  sent_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  claim_expires_at timestamptz,
  booked_at timestamptz,
  booking_total numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, customer_id)
);

create index if not exists idx_tomorrow_fill_recipients_campaign_rank
  on public.tomorrow_fill_recipients (campaign_id, rank);
create index if not exists idx_tomorrow_fill_recipients_customer_sent
  on public.tomorrow_fill_recipients (customer_id, sent_at desc);
create unique index if not exists idx_tomorrow_fill_recipients_appointment
  on public.tomorrow_fill_recipients (appointment_id)
  where appointment_id is not null;

create table if not exists public.tomorrow_fill_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.tomorrow_fill_campaigns(id) on delete cascade,
  recipient_id uuid references public.tomorrow_fill_recipients(id) on delete cascade,
  event_type text not null,
  actor text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tomorrow_fill_events_campaign_created
  on public.tomorrow_fill_events (campaign_id, created_at desc);

alter table public.ops_appointments
  add column if not exists tomorrow_fill_recipient_id uuid
    references public.tomorrow_fill_recipients(id) on delete set null;

create index if not exists idx_ops_appointments_tomorrow_fill_recipient
  on public.ops_appointments (tomorrow_fill_recipient_id)
  where tomorrow_fill_recipient_id is not null;

alter table public.sms_logs
  add column if not exists customer_id uuid
    references public.ops_customers(id) on delete set null,
  add column if not exists tomorrow_fill_recipient_id uuid
    references public.tomorrow_fill_recipients(id) on delete set null;

create index if not exists idx_sms_logs_tomorrow_fill_recipient
  on public.sms_logs (tomorrow_fill_recipient_id)
  where tomorrow_fill_recipient_id is not null;

-- This is a real invoice coupon. The customer link supplies it automatically;
-- the tier enforces the $250 minimum in every booking and invoice editor.
insert into public.promo_codes (
  code,
  discount_type,
  discount_amount,
  active,
  description
)
values (
  'TF35',
  'tiered',
  0,
  true,
  'Tomorrow Fill — $35 off a cleaning of $250 or more'
)
on conflict (code) do update
set discount_type = excluded.discount_type,
    discount_amount = excluded.discount_amount,
    active = excluded.active,
    description = excluded.description,
    expires_at = null,
    max_uses = null;

insert into public.promo_code_tiers (promo_code_id, min_spend, discount_amount)
select id, 250.00, 35.00
from public.promo_codes
where code = 'TF35'
on conflict (promo_code_id, min_spend) do update
set discount_amount = excluded.discount_amount;

-- Atomically reserve one of the campaign's limited offers. A crashed booking
-- releases itself after 15 minutes, so one browser cannot strand the campaign.
create or replace function public.reserve_tomorrow_fill_offer(
  p_token uuid,
  p_phone text
)
returns table (
  recipient_id uuid,
  campaign_id uuid,
  customer_id uuid,
  offer_code text,
  offer_amount numeric,
  minimum_subtotal numeric,
  target_date date,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient public.tomorrow_fill_recipients%rowtype;
  v_campaign public.tomorrow_fill_campaigns%rowtype;
  v_claimed integer;
begin
  select * into v_recipient
  from public.tomorrow_fill_recipients
  where booking_token = p_token
  for update;

  if not found or regexp_replace(v_recipient.phone_normalized, '\D', '', 'g')
      <> regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') then
    return;
  end if;

  select * into v_campaign
  from public.tomorrow_fill_campaigns
  where id = v_recipient.campaign_id
  for update;

  if not found
    or v_campaign.status not in ('active', 'sending')
    or v_campaign.expires_at <= now()
    or v_recipient.status not in ('sent', 'clicked', 'replied', 'claiming')
    or (
      v_recipient.status = 'claiming'
      and v_recipient.claim_expires_at > now()
    ) then
    return;
  end if;

  select count(*) into v_claimed
  from public.tomorrow_fill_recipients r
  where r.campaign_id = v_campaign.id
    and (
      r.status = 'booked'
      or (r.status = 'claiming' and r.claim_expires_at > now())
    )
    and r.id <> v_recipient.id;

  if v_claimed >= v_campaign.max_discounted_bookings then
    return;
  end if;

  update public.tomorrow_fill_recipients
  set status = 'claiming',
      claim_expires_at = now() + interval '15 minutes',
      updated_at = now()
  where id = v_recipient.id;

  return query
  select v_recipient.id,
         v_campaign.id,
         v_recipient.customer_id,
         v_campaign.offer_code,
         v_campaign.offer_amount,
         v_campaign.minimum_subtotal,
         v_campaign.target_date,
         v_campaign.expires_at;
end;
$$;

create or replace function public.release_tomorrow_fill_offer(p_recipient_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.tomorrow_fill_recipients
  set status = case when sent_at is null then 'selected' else 'sent' end,
      claim_expires_at = null,
      updated_at = now()
  where id = p_recipient_id and status = 'claiming';
$$;

create or replace function public.finalize_tomorrow_fill_booking(
  p_recipient_id uuid,
  p_appointment_id uuid,
  p_booking_total numeric,
  p_appointment_minutes integer,
  p_appointment_date date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign_id uuid;
  v_target_date date;
begin
  update public.tomorrow_fill_recipients
  set status = 'booked',
      appointment_id = p_appointment_id,
      booking_total = p_booking_total,
      booked_at = now(),
      claim_expires_at = null,
      updated_at = now()
  where id = p_recipient_id
  returning campaign_id into v_campaign_id;

  if v_campaign_id is null then
    return;
  end if;

  select target_date into v_target_date
  from public.tomorrow_fill_campaigns
  where id = v_campaign_id;

  update public.tomorrow_fill_campaigns
  set booked_count = booked_count + 1,
      booked_minutes = booked_minutes + case
        when p_appointment_date = v_target_date then greatest(0, p_appointment_minutes)
        else 0
      end,
      attributed_revenue = attributed_revenue + greatest(0, p_booking_total),
      status = case
        when booked_count + 1 >= max_discounted_bookings then 'filled'
        when p_appointment_date = v_target_date
          and booked_minutes + greatest(0, p_appointment_minutes) >= open_minutes then 'filled'
        else 'active'
      end,
      updated_at = now()
  where id = v_campaign_id;

  insert into public.tomorrow_fill_events (
    campaign_id,
    recipient_id,
    event_type,
    actor,
    detail
  ) values (
    v_campaign_id,
    p_recipient_id,
    'booked',
    'booking_widget',
    jsonb_build_object(
      'appointment_id', p_appointment_id,
      'booking_total', p_booking_total,
      'appointment_minutes', p_appointment_minutes,
      'appointment_date', p_appointment_date
    )
  );
end;
$$;

revoke all on function public.reserve_tomorrow_fill_offer(uuid, text) from public, anon, authenticated;
revoke all on function public.release_tomorrow_fill_offer(uuid) from public, anon, authenticated;
revoke all on function public.finalize_tomorrow_fill_booking(uuid, uuid, numeric, integer, date) from public, anon, authenticated;
grant execute on function public.reserve_tomorrow_fill_offer(uuid, text) to service_role;
grant execute on function public.release_tomorrow_fill_offer(uuid) to service_role;
grant execute on function public.finalize_tomorrow_fill_booking(uuid, uuid, numeric, integer, date) to service_role;

alter table public.tomorrow_fill_settings enable row level security;
alter table public.sms_marketing_consents enable row level security;
alter table public.tomorrow_fill_campaigns enable row level security;
alter table public.tomorrow_fill_recipients enable row level security;
alter table public.tomorrow_fill_events enable row level security;

revoke all on table public.tomorrow_fill_settings from anon, authenticated;
revoke all on table public.sms_marketing_consents from anon, authenticated;
revoke all on table public.tomorrow_fill_campaigns from anon, authenticated;
revoke all on table public.tomorrow_fill_recipients from anon, authenticated;
revoke all on table public.tomorrow_fill_events from anon, authenticated;

grant all on table public.tomorrow_fill_settings to service_role;
grant all on table public.sms_marketing_consents to service_role;
grant all on table public.tomorrow_fill_campaigns to service_role;
grant all on table public.tomorrow_fill_recipients to service_role;
grant all on table public.tomorrow_fill_events to service_role;
