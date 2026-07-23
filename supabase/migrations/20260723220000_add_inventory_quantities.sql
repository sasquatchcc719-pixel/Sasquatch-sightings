-- Real inventory tracking on the chemical/supply catalog: quantity on hand,
-- unit, and a reorder threshold that drives the daily low-stock Telegram
-- alert. low_stock_alerted_at prevents re-alerting every day — it resets
-- when stock rises back above the threshold.

alter table chemical_products
  add column if not exists quantity_on_hand numeric,
  add column if not exists quantity_unit text not null default 'jugs',
  add column if not exists reorder_threshold numeric,
  add column if not exists low_stock_alerted_at timestamptz;
