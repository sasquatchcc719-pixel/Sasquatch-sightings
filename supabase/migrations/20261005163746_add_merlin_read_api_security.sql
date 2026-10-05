create table if not exists public.api_v1_rate_limits (
  key_label text primary key,
  tokens double precision not null default 100,
  updated_at timestamptz not null default clock_timestamp(),
  constraint api_v1_rate_limits_tokens_check
    check (tokens >= 0 and tokens <= 100)
);

create table if not exists public.api_v1_request_logs (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  endpoint text not null,
  method text not null,
  status smallint not null,
  key_label text,
  duration_ms integer not null,
  constraint api_v1_request_logs_status_check
    check (status between 100 and 599),
  constraint api_v1_request_logs_duration_check
    check (duration_ms >= 0)
);

create index if not exists api_v1_request_logs_requested_at_idx
  on public.api_v1_request_logs (requested_at desc);

alter table public.api_v1_rate_limits enable row level security;
alter table public.api_v1_request_logs enable row level security;

revoke all on table public.api_v1_rate_limits from public, anon, authenticated;
revoke all on table public.api_v1_request_logs from public, anon, authenticated;
revoke all on sequence public.api_v1_request_logs_id_seq from public, anon, authenticated;
revoke all on table public.api_v1_rate_limits from service_role;
revoke all on table public.api_v1_request_logs from service_role;
revoke all on sequence public.api_v1_request_logs_id_seq from service_role;

grant select, insert, update on table public.api_v1_rate_limits to service_role;
grant insert on table public.api_v1_request_logs to service_role;
grant usage on sequence public.api_v1_request_logs_id_seq to service_role;

create or replace function public.consume_api_v1_token(p_key_label text)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_tokens double precision;
  last_updated timestamptz;
  checked_at timestamptz := clock_timestamp();
  available_tokens double precision;
begin
  if p_key_label is null or btrim(p_key_label) = '' then
    raise exception 'key label is required';
  end if;

  insert into public.api_v1_rate_limits (key_label, tokens, updated_at)
  values (p_key_label, 100, checked_at)
  on conflict (key_label) do nothing;

  select tokens, updated_at
    into current_tokens, last_updated
    from public.api_v1_rate_limits
    where key_label = p_key_label
    for update;

  -- One token refills each second: 60 requests/minute sustained, burst 100.
  available_tokens := least(
    100,
    current_tokens + greatest(0, extract(epoch from checked_at - last_updated))
  );

  if available_tokens >= 1 then
    update public.api_v1_rate_limits
      set tokens = available_tokens - 1,
          updated_at = checked_at
      where key_label = p_key_label;

    return query select true, 0;
  else
    update public.api_v1_rate_limits
      set tokens = available_tokens,
          updated_at = checked_at
      where key_label = p_key_label;

    return query
      select false, greatest(1, ceil(1 - available_tokens)::integer);
  end if;
end;
$$;

revoke all on function public.consume_api_v1_token(text)
  from public, anon, authenticated;
grant execute on function public.consume_api_v1_token(text) to service_role;

comment on table public.api_v1_rate_limits is
  'Shared token-bucket state for the authenticated read-only /api/v1 integration.';
comment on table public.api_v1_request_logs is
  'Credential-safe /api/v1 audit log. Query strings and bearer credentials are never stored.';
comment on function public.consume_api_v1_token(text) is
  'Atomically enforces 60 requests/minute sustained with a burst capacity of 100.';
