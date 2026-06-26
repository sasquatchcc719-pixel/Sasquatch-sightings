create or replace function public.current_app_role()
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select staff_users.role
      from staff_users
      where staff_users.user_id = auth.uid()
        and staff_users.is_active = true
      limit 1
    ),
    (
      select partners.role
      from partners
      where partners.user_id = auth.uid()
      limit 1
    )
  );
$$;
