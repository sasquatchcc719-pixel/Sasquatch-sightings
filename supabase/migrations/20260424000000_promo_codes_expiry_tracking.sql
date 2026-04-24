-- Add expiry, usage cap, and redemption tracking to promo_codes.
-- Also insert the codes that are hardcoded in the UI but were missing from the DB.

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_uses      INT,
  ADD COLUMN IF NOT EXISTS use_count     INT NOT NULL DEFAULT 0;

-- Atomic increment for use_count (called after a successful booking)
CREATE OR REPLACE FUNCTION increment_promo_use_count(promo_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE promo_codes SET use_count = use_count + 1 WHERE id = promo_id;
$$;

-- Insert codes that the UI references but that were never seeded
INSERT INTO promo_codes (code, discount_type, discount_amount, description)
VALUES
  ('SCC20',  'flat', 20.00, '$20 off — NFC business card holders'),
  ('NEXT20', 'flat', 20.00, '$20 off — post-service repeat / referral (links page)'),
  ('SHARE20','flat', 20.00, '$20 off — share deal referral (links page)')
ON CONFLICT (code) DO NOTHING;
