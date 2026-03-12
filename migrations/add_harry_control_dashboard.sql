CREATE TABLE IF NOT EXISTS harry_control_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  group_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

CREATE TABLE IF NOT EXISTS harry_logic_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  booking_mode TEXT NOT NULL DEFAULT 'bounded_auto_booking',
  prompt_overrides TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

CREATE TABLE IF NOT EXISTS harry_knowledge_blocks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE harry_control_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_logic_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_knowledge_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access to harry_control_settings" ON harry_control_settings;
CREATE POLICY "Admin full access to harry_control_settings"
  ON harry_control_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM partners p
      WHERE p.user_id = auth.uid()
        AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM partners p
      WHERE p.user_id = auth.uid()
        AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admin full access to harry_logic_profiles" ON harry_logic_profiles;
CREATE POLICY "Admin full access to harry_logic_profiles"
  ON harry_logic_profiles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM partners p
      WHERE p.user_id = auth.uid()
        AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM partners p
      WHERE p.user_id = auth.uid()
        AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admin full access to harry_knowledge_blocks" ON harry_knowledge_blocks;
CREATE POLICY "Admin full access to harry_knowledge_blocks"
  ON harry_knowledge_blocks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM partners p
      WHERE p.user_id = auth.uid()
        AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM partners p
      WHERE p.user_id = auth.uid()
        AND p.role = 'admin'
    )
  );

INSERT INTO harry_control_settings (setting_key, group_key, label, description, is_enabled)
VALUES
  ('global_enabled', 'safety', 'Global Harry Enable', 'Master toggle for all Harry automation.', true),
  ('inbound_channel_intake_enabled', 'inbound', 'Inbound Channel Intake', 'Allow inbound messages to enter Harry workflows.', true),
  ('auto_reply_enabled', 'reply', 'Auto Reply', 'Allow Harry to send automatic text responses.', true),
  ('booking_offers_enabled', 'booking', 'Booking Offers', 'Allow Harry to share booking links and slot offers.', true),
  ('auto_create_leads_enabled', 'booking', 'Auto Create Leads', 'Allow automatic lead creation from complete conversations.', true),
  ('escalation_alerts_enabled', 'escalation', 'Escalation Alerts', 'Allow admin escalation/error alerts from Harry.', true),
  ('inbound_email_notifications_enabled', 'notifications', 'Inbound Email Notifications', 'Send inbound summary emails with Harry replies.', true),
  ('call_missed_auto_sms_enabled', 'calls', 'Missed Call Auto SMS', 'Send Harry SMS after missed calls and after-hours calls.', true),
  ('channel_main_enabled', 'channels', 'Main Line Channel', 'Enable Harry automation for primary inbound channel.', true),
  ('channel_contest_enabled', 'channels', 'Contest Channel', 'Enable Harry automation for contest conversations.', true),
  ('channel_vendor_enabled', 'channels', 'Vendor Channel', 'Enable Harry automation for vendor-source conversations.', true),
  ('channel_business_card_enabled', 'channels', 'Business Card Channel', 'Enable Harry automation for direct business-card conversations.', true)
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO harry_logic_profiles (
  profile_key,
  label,
  channel_key,
  booking_mode,
  prompt_overrides,
  is_enabled
)
VALUES
  ('main_line', 'Main Line Profile', 'main', 'bounded_auto_booking', '', true),
  ('contest', 'Contest Profile', 'contest', 'bounded_auto_booking', '', true),
  ('vendor', 'Vendor Profile', 'vendor', 'bounded_auto_booking', '', true),
  ('business_card', 'Business Card Profile', 'business_card', 'bounded_auto_booking', '', true),
  ('inbound', 'Inbound Default Profile', 'inbound', 'bounded_auto_booking', '', true)
ON CONFLICT (profile_key) DO NOTHING;

INSERT INTO harry_knowledge_blocks (
  category_key,
  title,
  content,
  is_enabled,
  sort_order
)
VALUES
  ('services_pricing', 'Services + Pricing Rules', '', true, 10),
  ('booking_policies', 'Booking Policies', '', true, 20),
  ('faq_objections', 'FAQ + Objection Handling', '', true, 30),
  ('escalation_policy', 'Escalation Policy', '', true, 40),
  ('brand_voice', 'Brand Voice + Response Style', '', true, 50),
  ('compliance_blacklist', 'Do-Not-Say / Compliance Rules', '', true, 60)
ON CONFLICT (category_key) DO NOTHING;
