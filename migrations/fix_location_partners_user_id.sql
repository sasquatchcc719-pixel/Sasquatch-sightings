-- ============================================
-- FIX: Allow NULL user_id for location partners
-- Date: 2026-01-30
-- Purpose: Location partners don't need user accounts initially
-- ============================================

-- Drop the NOT NULL constraint on user_id
ALTER TABLE partners ALTER COLUMN user_id DROP NOT NULL;

-- Add a comment explaining this
COMMENT ON COLUMN partners.user_id IS 'User account ID. NULL for location partners until they create an account.';
