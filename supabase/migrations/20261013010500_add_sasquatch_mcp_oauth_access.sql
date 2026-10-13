create table if not exists public.mcp_authorized_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text not null,
  scopes text[] not null default array['business:read']::text[],
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_authorized_users_scopes_not_empty check (cardinality(scopes) > 0)
);

alter table public.mcp_authorized_users enable row level security;
revoke all on table public.mcp_authorized_users from public, anon, authenticated;
grant select on table public.mcp_authorized_users to service_role;

insert into public.mcp_authorized_users (user_id, label, scopes)
values (
  'f8b5e475-eaee-4b1c-9cf1-e40b7195a22f'::uuid,
  'Charles — Sasquatch owner',
  array['business:read']::text[]
)
on conflict (user_id) do update
set label = excluded.label,
    scopes = excluded.scopes,
    revoked_at = null,
    updated_at = now();

create or replace function public.sasquatch_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claims jsonb := event -> 'claims';
  oauth_client_id text := coalesce(
    event ->> 'client_id',
    event -> 'claims' ->> 'client_id'
  );
  is_oauth_token boolean :=
    oauth_client_id is not null
    or event ->> 'authentication_method' = 'oauth_provider/authorization_code';
  has_mcp_access boolean := false;
begin
  if not is_oauth_token then
    return event;
  end if;

  select exists (
    select 1
    from public.mcp_authorized_users authorized
    join public.staff_users staff on staff.user_id = authorized.user_id
    where authorized.user_id = (event ->> 'user_id')::uuid
      and authorized.revoked_at is null
      and 'business:read' = any(authorized.scopes)
      and staff.role = 'owner'
      and staff.is_active = true
  ) into has_mcp_access;

  claims := jsonb_set(
    claims,
    '{aud}',
    to_jsonb('https://sightings.sasquatchcarpet.com/mcp'::text),
    true
  );

  if has_mcp_access then
    claims := jsonb_set(
      claims,
      '{mcp_access}',
      to_jsonb('business:read'::text),
      true
    );
    claims := jsonb_set(
      claims,
      '{mcp_scopes}',
      '["business:read"]'::jsonb,
      true
    );
  else
    claims := claims - 'mcp_access' - 'mcp_scopes';
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.sasquatch_mcp_access_token_hook(jsonb)
  to supabase_auth_admin;
revoke execute on function public.sasquatch_mcp_access_token_hook(jsonb)
  from public, anon, authenticated;
