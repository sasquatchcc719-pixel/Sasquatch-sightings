-- ============================================
-- NFC CARD TRACKING - DATABASE MIGRATION
-- Date: 2026-01-30
-- Purpose: Track NFC card taps and conversions
-- ============================================

-- NFC Card Taps Table (track every tap)
CREATE TABLE IF NOT EXISTS nfc_card_taps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id TEXT,
  partner_id UUID REFERENCES partners(id),
  tap_type TEXT DEFAULT 'customer' CHECK (tap_type IN ('customer', 'partner')),
  
  -- Tap metadata
  ip_address TEXT,
  user_agent TEXT,
  device_type TEXT,
  location_city TEXT,
  location_region TEXT,
  location_country TEXT,
  
  -- Conversion tracking
  converted BOOLEAN DEFAULT false,
  lead_id UUID REFERENCES leads(id),
  conversion_type TEXT, -- 'form', 'call', 'text', 'save_contact'
  
  -- Timestamps
  tapped_at TIMESTAMPTZ DEFAULT now(),
  converted_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Button Click Tracking (track which buttons users click)
CREATE TABLE IF NOT EXISTS nfc_button_clicks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tap_id UUID REFERENCES nfc_card_taps(id) ON DELETE CASCADE,
  button_type TEXT NOT NULL CHECK (button_type IN ('call', 'text', 'form_submit', 'save_contact')),
  clicked_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_nfc_taps_tapped_at ON nfc_card_taps(tapped_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfc_taps_card_id ON nfc_card_taps(card_id) WHERE card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nfc_taps_partner_id ON nfc_card_taps(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nfc_taps_converted ON nfc_card_taps(converted);
CREATE INDEX IF NOT EXISTS idx_nfc_button_clicks_tap ON nfc_button_clicks(tap_id);

-- Enable RLS
ALTER TABLE nfc_card_taps ENABLE ROW LEVEL SECURITY;
ALTER TABLE nfc_button_clicks ENABLE ROW LEVEL SECURITY;

-- Public can insert taps (anonymous tracking)
CREATE POLICY "Anyone can record taps"
  ON nfc_card_taps FOR INSERT
  WITH CHECK (true);

-- Public can insert button clicks
CREATE POLICY "Anyone can record button clicks"
  ON nfc_button_clicks FOR INSERT
  WITH CHECK (true);

-- Admins can read all taps
CREATE POLICY "Admins can read all taps"
  ON nfc_card_taps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Partners can read their own taps
CREATE POLICY "Partners can read own taps"
  ON nfc_card_taps FOR SELECT
  USING (partner_id = auth.uid());

-- Admins can read all button clicks
CREATE POLICY "Admins can read all button clicks"
  ON nfc_button_clicks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = 'admin'
    )
  );

-- Comments
COMMENT ON TABLE nfc_card_taps IS 'Tracks every NFC card tap with metadata and conversion status';
COMMENT ON TABLE nfc_button_clicks IS 'Tracks which buttons users click after tapping the card';
COMMENT ON COLUMN nfc_card_taps.card_id IS 'Optional card identifier for tracking specific cards';
COMMENT ON COLUMN nfc_card_taps.partner_id IS 'For partner cards - links to partner account';
COMMENT ON COLUMN nfc_card_taps.tap_type IS 'customer = regular card, partner = partner portal card';
COMMENT ON COLUMN nfc_card_taps.converted IS 'True if tap resulted in a lead/contact';
