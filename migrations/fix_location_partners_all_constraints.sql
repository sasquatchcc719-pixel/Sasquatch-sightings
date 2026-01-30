-- ============================================
-- FIX ALL CONSTRAINTS FOR LOCATION PARTNERS
-- Date: 2026-01-30
-- Purpose: Allow location partners to be created without fields
--          that are only needed for referral partners
-- ============================================

-- Drop NOT NULL from user_id (location partners don't have user accounts)
ALTER TABLE partners ALTER COLUMN user_id DROP NOT NULL;

-- Drop NOT NULL from home_address (location partners are businesses, not individuals)
ALTER TABLE partners ALTER COLUMN home_address DROP NOT NULL;

-- Drop NOT NULL from phone (make it optional, location partners provide it separately)
ALTER TABLE partners ALTER COLUMN phone DROP NOT NULL;

-- Note: These columns remain NOT NULL because we provide them:
-- - name (we use company_name)
-- - email (we generate a placeholder)
-- - company_name (required in our form)
