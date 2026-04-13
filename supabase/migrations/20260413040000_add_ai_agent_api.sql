-- Add AI Agent API columns to settings table
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_agent_api_enabled BOOLEAN DEFAULT false;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_agent_promo_enabled BOOLEAN DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_agent_promo_discount DECIMAL(10,2) DEFAULT 20.00;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_agent_promo_minimum DECIMAL(10,2) DEFAULT 220.00;

-- Create agent_api_keys table
CREATE TABLE IF NOT EXISTS agent_api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Unnamed',
  booking_mode TEXT NOT NULL DEFAULT 'request' CHECK (booking_mode IN ('direct', 'request')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage agent_api_keys"
  ON agent_api_keys
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add pending_approval to ops_appointments status constraint
ALTER TABLE ops_appointments DROP CONSTRAINT IF EXISTS ops_appointments_status_check;
ALTER TABLE ops_appointments ADD CONSTRAINT ops_appointments_status_check CHECK (
  status IN ('booked', 'confirmed', 'on_my_way', 'in_progress', 'completed', 'cancelled', 'pending_approval')
);
