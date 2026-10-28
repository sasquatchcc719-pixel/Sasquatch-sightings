-- Supabase default privileges grant service_role more than this evidence table needs.
revoke all on public.ops_customer_email_history from service_role;
grant select, insert on public.ops_customer_email_history to service_role;
