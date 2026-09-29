alter table public.ops_commercial_profiles
  add column if not exists payment_process text not null default '',
  add column if not exists invoice_submission text not null default '';

create table if not exists public.ops_commercial_documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ops_customers(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  description text not null default '',
  filename text not null check (length(filename) between 1 and 255),
  mime_type text not null default 'application/pdf',
  storage_bucket text not null default 'commercial-documents',
  storage_path text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (customer_id, storage_bucket, storage_path)
);

create index if not exists ops_commercial_documents_customer_published_idx
  on public.ops_commercial_documents(customer_id, published_at desc);

alter table public.ops_commercial_documents enable row level security;
revoke all on public.ops_commercial_documents from anon, authenticated;
grant all on public.ops_commercial_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'commercial-documents',
  'commercial-documents',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.ops_commercial_documents (
  id,
  customer_id,
  title,
  description,
  filename,
  storage_path,
  published_at
)
select
  '4dcf2af1-92a1-4cf3-8d7a-e3ff0ce20893'::uuid,
  id,
  'Sasquatch Carpet Cleaning W-9',
  'Completed and signed Form W-9 for vendor and accounts-payable records.',
  'Sasquatch-Carpet-Cleaning-W9-2026.pdf',
  'bb862cbe-d3a8-4f87-a17c-7b00e54903b6/sasquatch-carpet-cleaning-w9-2026.pdf',
  '2026-09-16 00:00:00+00'::timestamptz
from public.ops_customers
where id = 'bb862cbe-d3a8-4f87-a17c-7b00e54903b6'::uuid
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  filename = excluded.filename,
  storage_bucket = excluded.storage_bucket,
  storage_path = excluded.storage_path,
  published_at = excluded.published_at;
