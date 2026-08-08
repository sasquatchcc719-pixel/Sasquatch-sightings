-- Spend-based tiered promo codes. Existing promo_codes only supported a
-- single flat or percent discount; the pet-stain (and future military)
-- campaign needs "$25 off $200+, $50 off $500+, $75 off $800+" — a real
-- discount tier, not a flat rate. discount_amount stays NOT NULL on
-- promo_codes for tiered rows (set to 0, unused) so the column keeps its
-- constraint; the actual amounts live in promo_code_tiers.

ALTER TABLE promo_codes DROP CONSTRAINT promo_codes_discount_type_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_discount_type_check
  CHECK (discount_type IN ('flat', 'percent', 'tiered'));

CREATE TABLE IF NOT EXISTS promo_code_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  min_spend NUMERIC(10, 2) NOT NULL,
  discount_amount NUMERIC(10, 2) NOT NULL,
  UNIQUE (promo_code_id, min_spend)
);

ALTER TABLE promo_code_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON promo_code_tiers
  FOR ALL TO service_role USING (true);

INSERT INTO promo_codes (code, discount_type, discount_amount, description) VALUES
  ('PET', 'tiered', 0, 'Pet stain treatment — $25 off $200+, $50 off $500+, $75 off $800+ (jobs under $200 not eligible)');

INSERT INTO promo_code_tiers (promo_code_id, min_spend, discount_amount)
SELECT id, 200.00, 25.00 FROM promo_codes WHERE code = 'PET'
UNION ALL
SELECT id, 500.00, 50.00 FROM promo_codes WHERE code = 'PET'
UNION ALL
SELECT id, 800.00, 75.00 FROM promo_codes WHERE code = 'PET';
