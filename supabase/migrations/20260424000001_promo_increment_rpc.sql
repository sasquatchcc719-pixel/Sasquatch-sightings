-- Atomic increment for promo_codes.use_count
-- Called from /api/public/appointments after a successful booking.
CREATE OR REPLACE FUNCTION increment_promo_use_count(promo_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE promo_codes SET use_count = use_count + 1 WHERE id = promo_id;
$$;
