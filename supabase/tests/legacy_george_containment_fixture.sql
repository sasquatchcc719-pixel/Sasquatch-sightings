-- Fresh local PostgreSQL/PGlite only; never run this fixture in production.
create role anon;
create role authenticated;
create role service_role;
create function public.george_read_query(sql_query text) returns jsonb
language sql security definer set search_path='' as $$ select '[]'::jsonb $$;
grant usage on schema public to anon,authenticated,service_role;
grant execute on function public.george_read_query(text) to public,anon,authenticated,service_role;
-- APPLY_LEGACY_GEORGE_CONTAINMENT_MIGRATION_HERE

do $$ begin
 if has_function_privilege('anon','public.george_read_query(text)','execute') or has_function_privilege('authenticated','public.george_read_query(text)','execute') then raise exception 'Legacy SQL RPC still exposed'; end if;
 if not has_function_privilege('service_role','public.george_read_query(text)','execute') then raise exception 'Internal service access unexpectedly removed'; end if;
end $$;
set role anon;
do $$ begin
 begin perform public.george_read_query('select 1'); raise exception 'Anonymous execution succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
 begin perform public.george_read_query('select 1'); raise exception 'Authenticated execution succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
select public.george_read_query('select 1');
reset role;
