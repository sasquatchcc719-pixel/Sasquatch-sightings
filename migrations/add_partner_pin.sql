-- ============================================
-- Add PIN for location partner login
-- Date: 2026-01-30
-- Purpose: Simple 4-digit PIN for partner portal access
-- ============================================

-- Add PIN column to partners table
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pin TEXT;

-- Comment
COMMENT ON COLUMN partners.pin IS '4-digit PIN for location partner portal access';
