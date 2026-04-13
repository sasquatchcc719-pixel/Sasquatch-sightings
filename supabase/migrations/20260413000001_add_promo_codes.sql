-- Promo codes table for public booking widget
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('flat', 'percent')),
  discount_amount NUMERIC(10, 2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial promo codes
INSERT INTO promo_codes (code, discount_type, discount_amount, description) VALUES
  ('SASQUATCH20', 'flat', 20.00, '$20 off — Sasquatch Sightings contest winner code'),
  ('SIGHTINGS10', 'percent', 10.00, '10% off — Sightings referral code'),
  ('NEXTDOOR15', 'flat', 15.00, '$15 off — Nextdoor neighbor discount'),
  ('FIRSTCLEAN', 'flat', 25.00, '$25 off first cleaning'),
  ('PARTNER10', 'percent', 10.00, '10% off — referral partner discount');

-- RLS: public can only read active codes by exact match (validated server-side, so no RLS needed)
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write promo codes (all validation done server-side)
CREATE POLICY "Service role full access" ON promo_codes
  FOR ALL TO service_role USING (true);
