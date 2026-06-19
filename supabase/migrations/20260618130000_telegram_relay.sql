-- Telegram relay (no-LLM pipe) — replaces Harry for inbound SMS handling.
--
-- Inbound customer SMS is forwarded into a Telegram forum topic (one thread
-- per customer). Charles replies in the topic; the reply is sent back as an
-- SMS FROM THE SAME business number the customer originally texted.
--
-- Two tables:
--   telegram_relay_groups  — the two destination supergroups, keyed by role.
--                            Auto-discovered by the relay webhook the first
--                            time the bot sees a message in each group.
--   telegram_relay_threads — phone <-> (group, topic) mapping, one row per
--                            customer phone, so people never get mixed up.

-- The two groups Charles created: "LSA Leads" (role 'lsa') and "Customers"
-- (role 'customers'). chat_id is the Telegram supergroup id (negative bigint).
create table if not exists public.telegram_relay_groups (
  role        text primary key check (role in ('lsa', 'customers')),
  chat_id     bigint not null,
  title       text,
  updated_at  timestamptz not null default now()
);

-- One forum topic per customer phone. Reused for every future message from
-- that phone, regardless of which business number they text, so the whole
-- history with a person lives in a single thread.
create table if not exists public.telegram_relay_threads (
  id               uuid primary key default gen_random_uuid(),
  phone            text not null unique,        -- normalized E.164 (matches conversations.phone_number)
  group_chat_id    bigint not null,             -- which supergroup the topic lives in
  topic_id         integer not null,            -- Telegram message_thread_id of the forum topic
  business_number  text,                        -- last number the customer texted (719 vs 866); replies go FROM this
  customer_name    text,                        -- snapshot used for the topic name
  is_lsa           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Reverse lookup: a Telegram reply arrives with (chat_id, message_thread_id);
-- we map it back to the customer phone.
create index if not exists telegram_relay_threads_group_topic_idx
  on public.telegram_relay_threads (group_chat_id, topic_id);

-- Service-role only (relay runs server-side with the admin client). Enable RLS
-- with no policies so nothing is reachable from the anon/auth client.
alter table public.telegram_relay_groups  enable row level security;
alter table public.telegram_relay_threads enable row level security;
