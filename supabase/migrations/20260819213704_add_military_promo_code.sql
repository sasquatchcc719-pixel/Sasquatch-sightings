insert into public.promo_codes (
  code,
  discount_type,
  discount_amount,
  active,
  description
)
values (
  'MILITARY',
  'tiered',
  0,
  true,
  'Military and veteran discount — $25 off $200+, $50 off $500+, $75 off $800+ (jobs under $200 not eligible)'
)
on conflict (code) do update
set discount_type = excluded.discount_type,
    discount_amount = excluded.discount_amount,
    active = excluded.active,
    description = excluded.description,
    expires_at = null;

insert into public.promo_code_tiers (
  promo_code_id,
  min_spend,
  discount_amount
)
select id, tier.min_spend, tier.discount_amount
from public.promo_codes
cross join (
  values
    (200.00::numeric, 25.00::numeric),
    (500.00::numeric, 50.00::numeric),
    (800.00::numeric, 75.00::numeric)
) as tier(min_spend, discount_amount)
where code = 'MILITARY'
on conflict (promo_code_id, min_spend) do update
set discount_amount = excluded.discount_amount;
