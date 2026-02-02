-- Harry's Conversation Memory
-- Run this in Supabase SQL Editor

-- Store all conversations with Harry
CREATE TABLE harry_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast retrieval of recent messages
CREATE INDEX idx_harry_conversations_created ON harry_conversations(created_at DESC);

-- Store conversation summaries (for long-term memory)
CREATE TABLE harry_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_type TEXT NOT NULL, -- 'decision', 'insight', 'goal', 'fact'
  content TEXT NOT NULL,
  importance INTEGER DEFAULT 5, -- 1-10, higher = more important
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ -- optional expiration for temporary context
);

CREATE INDEX idx_harry_memory_type ON harry_memory(memory_type);
CREATE INDEX idx_harry_memory_importance ON harry_memory(importance DESC);

-- Enable RLS
ALTER TABLE harry_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE harry_memory ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view harry conversations"
  ON harry_conversations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert harry conversations"
  ON harry_conversations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Service role full access conversations"
  ON harry_conversations FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can view harry memory"
  ON harry_memory FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can manage harry memory"
  ON harry_memory FOR ALL TO authenticated USING (true);

CREATE POLICY "Service role full access memory"
  ON harry_memory FOR ALL TO service_role USING (true);
