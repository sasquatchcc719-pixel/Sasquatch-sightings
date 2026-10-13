\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid()
);

-- APPLY_MCP_EVENTS_MIGRATION_HERE

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001');
insert into public.conversations (id) values
  ('20000000-0000-4000-8000-000000000001');

do $$
begin
  if not exists (
    select 1 from pg_class
    where oid = 'public.mcp_event_subscriptions'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_class
    where oid = 'public.mcp_inbound_event_ledger'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_class
    where oid = 'public.mcp_event_deliveries'::regclass and relrowsecurity
  ) then
    raise exception 'MCP event tables must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.mcp_event_subscriptions', 'select')
     or has_table_privilege('authenticated', 'public.mcp_event_subscriptions', 'select')
     or not has_table_privilege('service_role', 'public.mcp_event_subscriptions', 'select,insert,update') then
    raise exception 'MCP event table grants are unsafe';
  end if;
end $$;

insert into public.mcp_event_subscriptions (
  id, owner_user_id, event_name, arguments, arguments_hash, callback_url,
  callback_secret, verified_at, expires_at
) values (
  'sub_11111111111111111111111111111111',
  '10000000-0000-4000-8000-000000000001',
  'conversation.message.received',
  '{}'::jsonb,
  repeat('a', 64),
  'https://events.example.test/callback',
  'whsec_c3ludGhldGljLXRlc3Qta2V5LWlzLTMyaGJ5dGVzMDA=',
  now(),
  now() + interval '1 day'
);

insert into public.mcp_inbound_event_ledger (
  message_sid, status, conversation_id, event_payload, persisted_at
) values (
  'SM11111111111111111111111111111111',
  'persisted',
  '20000000-0000-4000-8000-000000000001',
  '{"channel":"sms"}'::jsonb,
  now()
);

insert into public.mcp_event_deliveries (
  id, subscription_id, event_id, event_name, occurred_at, payload
) values (
  'evt_1111111111111111111111111111111111111111',
  'sub_11111111111111111111111111111111',
  'sms_fixture',
  'conversation.message.received',
  now(),
  '{"channel":"sms"}'::jsonb
);

do $$
begin
  begin
    insert into public.mcp_event_subscriptions (
      id, owner_user_id, event_name, arguments_hash, callback_url,
      callback_secret, verified_at
    ) values (
      'sub_22222222222222222222222222222222',
      '10000000-0000-4000-8000-000000000001',
      'unsupported.event',
      repeat('b', 64),
      'https://events.example.test/callback',
      'whsec_c3ludGhldGljLXRlc3Qta2V5LWlzLTMyaGJ5dGVzMDA=',
      now()
    );
    raise exception 'unsupported event unexpectedly accepted';
  exception when check_violation then null;
  end;

  if (select count(*) from public.mcp_event_subscriptions) <> 1
     or (select count(*) from public.mcp_inbound_event_ledger) <> 1
     or (select count(*) from public.mcp_event_deliveries) <> 1 then
    raise exception 'MCP event fixture row counts are wrong';
  end if;
end $$;

select 'MCP events migration fixture passed' as result;
