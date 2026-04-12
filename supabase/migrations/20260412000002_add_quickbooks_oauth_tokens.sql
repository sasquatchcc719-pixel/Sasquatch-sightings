CREATE TABLE IF NOT EXISTS quickbooks_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Only one row ever exists (one QBO company)
CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_oauth_tokens_single_row
  ON quickbooks_oauth_tokens ((true));
