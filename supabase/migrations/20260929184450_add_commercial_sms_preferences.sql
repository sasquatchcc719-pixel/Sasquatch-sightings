alter table public.ops_commercial_profiles
  add column if not exists scheduling_sms_phone text not null default '',
  add column if not exists scheduling_sms_enabled boolean not null default false,
  add column if not exists scheduling_sms_consent_at timestamptz,
  add column if not exists scheduling_sms_consent_text text,
  add column if not exists scheduling_sms_consent_source text,
  add column if not exists scheduling_sms_opted_out_at timestamptz;

alter table public.ops_commercial_profiles
  drop constraint if exists ops_commercial_profiles_scheduling_sms_check;

alter table public.ops_commercial_profiles
  add constraint ops_commercial_profiles_scheduling_sms_check check (
    not scheduling_sms_enabled
    or (
      scheduling_sms_phone ~ '^\+1[0-9]{10}$'
      and scheduling_sms_consent_at is not null
      and length(trim(coalesce(scheduling_sms_consent_text, ''))) > 0
      and scheduling_sms_consent_source = 'commercial_portal'
    )
  );

create table if not exists public.ops_sms_consent_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ops_customers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  phone text not null,
  action text not null check (action in ('opted_in', 'opted_out')),
  consent_text text,
  source text not null check (source in ('commercial_portal', 'customer_reply')),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists ops_sms_consent_events_customer_created_idx
  on public.ops_sms_consent_events(customer_id, created_at desc);

alter table public.ops_sms_consent_events enable row level security;
revoke all on public.ops_sms_consent_events from anon, authenticated;
grant all on public.ops_sms_consent_events to service_role;

create or replace function public.set_commercial_sms_preference(
  p_customer_id uuid,
  p_user_id uuid,
  p_phone text,
  p_enabled boolean,
  p_consent_text text,
  p_source text,
  p_ip_address text default null,
  p_user_agent text default null
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  event_time timestamptz := now();
begin
  if p_source not in ('commercial_portal', 'customer_reply') then
    raise exception 'Unsupported SMS preference source';
  end if;

  if p_enabled and (
    p_phone !~ '^\+1[0-9]{10}$'
    or length(trim(coalesce(p_consent_text, ''))) = 0
    or p_source <> 'commercial_portal'
  ) then
    raise exception 'A valid mobile number and portal authorization are required';
  end if;

  insert into public.ops_commercial_profiles (
    customer_id,
    scheduling_sms_phone,
    scheduling_sms_enabled,
    scheduling_sms_consent_at,
    scheduling_sms_consent_text,
    scheduling_sms_consent_source,
    scheduling_sms_opted_out_at,
    updated_by,
    updated_at
  ) values (
    p_customer_id,
    p_phone,
    p_enabled,
    case when p_enabled then event_time else null end,
    case when p_enabled then p_consent_text else null end,
    case when p_enabled then p_source else null end,
    case when p_enabled then null else event_time end,
    p_user_id,
    event_time
  )
  on conflict (customer_id) do update set
    scheduling_sms_phone = excluded.scheduling_sms_phone,
    scheduling_sms_enabled = excluded.scheduling_sms_enabled,
    scheduling_sms_consent_at = case
      when excluded.scheduling_sms_enabled then event_time
      else public.ops_commercial_profiles.scheduling_sms_consent_at
    end,
    scheduling_sms_consent_text = case
      when excluded.scheduling_sms_enabled then excluded.scheduling_sms_consent_text
      else public.ops_commercial_profiles.scheduling_sms_consent_text
    end,
    scheduling_sms_consent_source = case
      when excluded.scheduling_sms_enabled then excluded.scheduling_sms_consent_source
      else public.ops_commercial_profiles.scheduling_sms_consent_source
    end,
    scheduling_sms_opted_out_at = case
      when excluded.scheduling_sms_enabled then null
      else event_time
    end,
    updated_by = coalesce(excluded.updated_by, public.ops_commercial_profiles.updated_by),
    updated_at = event_time;

  insert into public.ops_sms_consent_events (
    customer_id,
    user_id,
    phone,
    action,
    consent_text,
    source,
    ip_address,
    user_agent,
    created_at
  ) values (
    p_customer_id,
    p_user_id,
    p_phone,
    case when p_enabled then 'opted_in' else 'opted_out' end,
    case when p_enabled then p_consent_text else null end,
    p_source,
    p_ip_address,
    p_user_agent,
    event_time
  );
end;
$$;

revoke all on function public.set_commercial_sms_preference(uuid, uuid, text, boolean, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_commercial_sms_preference(uuid, uuid, text, boolean, text, text, text, text)
  to service_role;
