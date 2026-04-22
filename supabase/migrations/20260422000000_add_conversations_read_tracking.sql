-- Add read-tracking and ops-customer linkage to conversations table.
-- admin_read_at: timestamp of when admin last read this conversation.
--   NULL or < updated_at means there are unread inbound messages.
-- ops_customer_id: links the conversation to a known scheduled customer.
--   When set, Harry auto-reply is disabled (ai_enabled = false) so the
--   admin reviews and decides whether to reply manually or invoke Harry draft.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS admin_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ops_customer_id UUID REFERENCES ops_customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_admin_read_at
  ON conversations(admin_read_at);

CREATE INDEX IF NOT EXISTS idx_conversations_ops_customer_id
  ON conversations(ops_customer_id);

COMMENT ON COLUMN conversations.admin_read_at IS 'Timestamp when admin last viewed this conversation. NULL or older than updated_at = unread.';
COMMENT ON COLUMN conversations.ops_customer_id IS 'FK to ops_customers if the sender is a known scheduled customer. Harry auto-reply is disabled for these conversations.';
