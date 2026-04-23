-- Fix Supabase Security Advisor warnings:
--   1. Function Search Path Mutable → lock search_path on all 8 flagged functions
--   2. RLS Policy Always True → tighten policies that are named "service role" but
--      use USING (true), and restrict internal admin tables to staff roles

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: Lock search_path on all flagged functions
-- Prevents search_path injection if a rogue schema shadows public objects.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.app_has_role(allowed_roles text[])             SET search_path = public;
ALTER FUNCTION public.current_app_role()                             SET search_path = public;
ALTER FUNCTION public.george_read_query(sql_query text)              SET search_path = public;
ALTER FUNCTION public.get_customer_stats_batch(customer_ids uuid[])  SET search_path = public;
ALTER FUNCTION public.assign_invoice_number()                        SET search_path = public;
ALTER FUNCTION public.create_lead_from_sighting()                    SET search_path = public;
ALTER FUNCTION public.create_lead_from_referral()                    SET search_path = public;
ALTER FUNCTION public.update_phone_settings_updated_at()             SET search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: Fix "Service role full access" policies that used USING (true)
-- These were named "service role" but granted access to all authenticated users.
-- ─────────────────────────────────────────────────────────────────────────────

-- agent_api_keys
DROP POLICY IF EXISTS "Service role can manage agent_api_keys" ON agent_api_keys;
CREATE POLICY "Service role can manage agent_api_keys" ON agent_api_keys
  FOR ALL USING (auth.role() = 'service_role');

-- promo_codes
DROP POLICY IF EXISTS "Service role full access" ON promo_codes;
CREATE POLICY "Service role full access" ON promo_codes
  FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3: Tighten internal admin tables to staff roles
-- "Authenticated users can view/manage" with USING (true) means any logged-in
-- user — tighten to actual staff roles.
-- ─────────────────────────────────────────────────────────────────────────────

-- competitors
DROP POLICY IF EXISTS "Service role full access" ON competitors;
DROP POLICY IF EXISTS "Authenticated users can view competitors" ON competitors;
DROP POLICY IF EXISTS "Authenticated users can update competitors" ON competitors;

CREATE POLICY "competitors_read" ON competitors
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

CREATE POLICY "competitors_write" ON competitors
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'marketing')
    )
  );

-- harry_conversations
DROP POLICY IF EXISTS "Service role full access conversations" ON harry_conversations;
DROP POLICY IF EXISTS "Authenticated users can view harry conversations" ON harry_conversations;

CREATE POLICY "harry_conversations_read" ON harry_conversations
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner')
    )
  );

CREATE POLICY "harry_conversations_service" ON harry_conversations
  FOR ALL USING (auth.role() = 'service_role');

-- harry_memory
DROP POLICY IF EXISTS "Service role full access memory" ON harry_memory;
DROP POLICY IF EXISTS "Authenticated users can manage harry memory" ON harry_memory;
DROP POLICY IF EXISTS "Authenticated users can view harry memory" ON harry_memory;

CREATE POLICY "harry_memory_read" ON harry_memory
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner')
    )
  );

CREATE POLICY "harry_memory_service" ON harry_memory
  FOR ALL USING (auth.role() = 'service_role');

-- market_intel
DROP POLICY IF EXISTS "Service role can manage all market intel" ON market_intel;
DROP POLICY IF EXISTS "Authenticated users can view market intel" ON market_intel;

CREATE POLICY "market_intel_read" ON market_intel
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'marketing')
    )
  );

CREATE POLICY "market_intel_service" ON market_intel
  FOR ALL USING (auth.role() = 'service_role');

-- market_intel_targets
DROP POLICY IF EXISTS "Service role can manage all market intel targets" ON market_intel_targets;
DROP POLICY IF EXISTS "Authenticated users can view market intel targets" ON market_intel_targets;
DROP POLICY IF EXISTS "Authenticated users can update market intel targets" ON market_intel_targets;
DROP POLICY IF EXISTS "Authenticated users can delete market intel targets" ON market_intel_targets;

CREATE POLICY "market_intel_targets_read" ON market_intel_targets
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'marketing')
    )
  );

CREATE POLICY "market_intel_targets_write" ON market_intel_targets
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'marketing')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: The following are intentionally left as USING (true) — they are
-- publicly readable by design:
--   services          → public service catalog
--   sightings         → public SEO job pages
--   nfc_button_clicks → anonymous NFC tap analytics
--   nfc_card_taps     → anonymous NFC tap analytics
-- ─────────────────────────────────────────────────────────────────────────────
