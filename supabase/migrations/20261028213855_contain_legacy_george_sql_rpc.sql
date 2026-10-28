-- George's orchestration was retired in June. Its arbitrary-SQL SECURITY
-- DEFINER helper must not remain callable by public/web roles: even a SELECT
-- can bypass table RLS or invoke a privileged function. Preserve only internal
-- service callers; do not change unrelated tables or operational permissions.
revoke all on function public.george_read_query(text) from public, anon, authenticated;
grant execute on function public.george_read_query(text) to service_role;
