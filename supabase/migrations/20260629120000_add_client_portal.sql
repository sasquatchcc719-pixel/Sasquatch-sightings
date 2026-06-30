-- Client Portal: scoped logins for commercial-contract managers (e.g. Recovery Village / Lance Johnson).
-- A client_manager is an external user tied to exactly one ops_customers record. They can view their own
-- recurring schedule, add per-visit notes, skip a single visit, and submit change requests that Charles
-- approves. They never touch templates, reschedule, reassign techs, or change pricing directly.

-- 1. Maps an auth user -> a single customer, with role 'client_manager'.
CREATE TABLE IF NOT EXISTS ops_client_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  customer_id UUID REFERENCES ops_customers(id) ON DELETE CASCADE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_client_users_user ON ops_client_users(user_id);
CREATE INDEX IF NOT EXISTS idx_ops_client_users_customer ON ops_client_users(customer_id);

-- 2. Change requests + activity log from client managers.
--    Direct, already-executed actions (skip_visit) are logged with status 'done'.
--    Approval-required actions (reschedule, add_visit, scope_change, other) start 'pending'.
CREATE TABLE IF NOT EXISTS ops_client_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES ops_customers(id) ON DELETE CASCADE NOT NULL,
  requested_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_name TEXT,
  appointment_id UUID REFERENCES ops_appointments(id) ON DELETE SET NULL,
  template_id UUID REFERENCES ops_recurring_templates(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (
    request_type IN ('reschedule', 'add_visit', 'scope_change', 'skip_visit', 'other')
  ),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'declined', 'done')
  ),
  admin_notes TEXT,
  resolved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_change_requests_customer ON ops_client_change_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_client_change_requests_status ON ops_client_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_client_change_requests_created ON ops_client_change_requests(created_at DESC);

-- 3. Per-visit note authored by the client manager. Kept separate from internal_notes so it never
--    collides with staff notes. Surfaced to the field tech.
ALTER TABLE ops_appointments ADD COLUMN IF NOT EXISTS client_note TEXT;

-- RLS: enable but add no policies. All client-portal access goes through service-role API routes that
-- scope every query by the authenticated user's customer_id, so RLS stays default-deny for anon/authed
-- direct access (defense in depth).
ALTER TABLE ops_client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_client_change_requests ENABLE ROW LEVEL SECURITY;
