-- Chemical inventory for the Foreman field AI assistant (Module 4A).
-- chemical_products: truck chemical catalog with scraped label/dilution specs.
--   Scraped specs are DRAFTS (scrape_status 'scraped') until Charles approves
--   them ('reviewed'). The Foreman assistant only recommends in_stock products.
-- ai_diagnostic_logs: every field AI diagnosis, for auditing recommendations.
-- RLS enabled with no policies: service-role (admin client) access only.

create table if not exists chemical_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  in_stock boolean not null default true,
  ph_range text,
  dilution_hydroforce text,
  dilution_pump_sprayer text,
  label_instructions text,
  sds_warnings text,
  scenarios text[] not null default '{}',
  incompatible_with text[] not null default '{}',
  source_urls text[] not null default '{}',
  scrape_status text not null default 'pending'
    check (scrape_status in ('pending', 'scraped', 'reviewed', 'failed')),
  scrape_error text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table chemical_products enable row level security;

create table if not exists ai_diagnostic_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  photo_urls text[] not null default '{}',
  transcript text,
  detected jsonb,
  recommendation jsonb,
  guardrails_fired text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table ai_diagnostic_logs enable row level security;

create index if not exists idx_chemical_products_in_stock
  on chemical_products (in_stock);
create index if not exists idx_ai_diagnostic_logs_created
  on ai_diagnostic_logs (created_at desc);
