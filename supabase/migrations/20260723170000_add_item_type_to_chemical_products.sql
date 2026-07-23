-- The truck inventory holds more than chemistry: bonnets, pads, and other
-- consumable gear the Foreman assistant can reference (e.g. "buff with the
-- microfiber agitation bonnet"). Tag each row with what it is.

alter table chemical_products
  add column if not exists item_type text not null default 'chemical'
    check (item_type in ('chemical', 'supply', 'equipment'));
