-- Atomic SerpApi quota reservations using the existing system_settings table.
-- The app computes the billing-cycle period start (SerpApi renews on the 6th)
-- and this function increments the matching monthly counter under a database
-- advisory lock before any paid SerpApi request is sent.
create or replace function public.reserve_serpapi_search(
  p_period_start text,
  p_source text,
  p_query text,
  p_monthly_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
  v_calls jsonb;
  v_used integer;
  v_call jsonb;
begin
  if p_period_start is null or p_period_start !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'SerpApi period start must be YYYY-MM-DD';
  end if;

  if p_monthly_limit is null or p_monthly_limit < 1 then
    raise exception 'SerpApi monthly limit must be positive';
  end if;

  v_key := 'serpapi_usage_' || p_period_start;

  perform pg_advisory_xact_lock(hashtext(v_key));

  select value
    into v_value
    from public.system_settings
   where key = v_key
   for update;

  if v_value is null or jsonb_typeof(v_value) is distinct from 'object' then
    v_value := jsonb_build_object(
      'period_start', p_period_start,
      'limit', p_monthly_limit,
      'used', 0,
      'remaining', p_monthly_limit,
      'calls', '[]'::jsonb
    );

    insert into public.system_settings (key, value, updated_at)
    values (v_key, v_value, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_at = now()
      where jsonb_typeof(public.system_settings.value) is distinct from 'object';

    select value
      into v_value
      from public.system_settings
     where key = v_key
     for update;
  end if;

  v_used := case
    when (v_value ->> 'used') ~ '^\d+$' then (v_value ->> 'used')::integer
    else 0
  end;

  if v_used >= p_monthly_limit then
    raise exception 'SerpApi monthly quota reached: % of % searches used for cycle starting %',
      v_used, p_monthly_limit, p_period_start;
  end if;

  v_used := v_used + 1;
  v_calls := coalesce(v_value -> 'calls', '[]'::jsonb);
  if jsonb_typeof(v_calls) is distinct from 'array' then
    v_calls := '[]'::jsonb;
  end if;

  v_call := jsonb_build_object(
    'at', now(),
    'source', left(coalesce(p_source, 'unknown'), 120),
    'query', left(coalesce(p_query, ''), 500)
  );

  v_value := jsonb_build_object(
    'period_start', p_period_start,
    'limit', p_monthly_limit,
    'used', v_used,
    'remaining', greatest(p_monthly_limit - v_used, 0),
    'last_call_at', now(),
    'calls', v_calls || jsonb_build_array(v_call)
  );

  update public.system_settings
     set value = v_value,
         updated_at = now()
   where key = v_key;

  return v_value - 'calls';
end;
$$;

comment on function public.reserve_serpapi_search(text, text, text, integer)
  is 'Atomically reserves one SerpApi search against the monthly billing-cycle budget.';

revoke all on function public.reserve_serpapi_search(text, text, text, integer) from public;
revoke all on function public.reserve_serpapi_search(text, text, text, integer) from anon;
revoke all on function public.reserve_serpapi_search(text, text, text, integer) from authenticated;
grant execute on function public.reserve_serpapi_search(text, text, text, integer) to service_role;
