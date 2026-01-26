-- Create conversations table for AI dispatcher
-- Stores SMS conversation history for context-aware AI responses

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  source TEXT, -- 'contest_entry', 'partner_referral', 'missed_call', 'inbound', etc.
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  messages JSONB DEFAULT '[]'::jsonb,
  ai_enabled BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'escalated')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_conversations_updated_at();

-- RLS Policies
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Admin can see all conversations
CREATE POLICY "Admin can view all conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM partners
      WHERE partners.user_id = auth.uid()
      AND partners.role = 'admin'
    )
  );

-- Admin can manage all conversations
CREATE POLICY "Admin can manage conversations"
  ON conversations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM partners
      WHERE partners.user_id = auth.uid()
      AND partners.role = 'admin'
    )
  );

-- Comments
COMMENT ON TABLE conversations IS 'Stores SMS conversation history for AI dispatcher';
COMMENT ON COLUMN conversations.messages IS 'Array of message objects: {role: "user"|"assistant", content: string, timestamp: ISO8601}';
COMMENT ON COLUMN conversations.ai_enabled IS 'Whether AI should respond to this conversation';
COMMENT ON COLUMN conversations.status IS 'active = ongoing, completed = customer booked/satisfied, escalated = needs human attention';
