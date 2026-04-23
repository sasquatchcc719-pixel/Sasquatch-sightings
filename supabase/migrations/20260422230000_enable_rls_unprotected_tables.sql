-- Enable RLS on all tables flagged by Supabase Security Advisor.
-- All API routes use createAdminClient() (service_role), which bypasses RLS
-- entirely, so these policies only gate direct anon/authenticated access.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. quickbooks_oauth_tokens — raw OAuth tokens; service_role only
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE quickbooks_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- No policies added — deny-by-default for all non-service-role clients.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. phone_settings — Twilio/IVR config; owner + admin only
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE phone_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "phone_settings_read" ON phone_settings
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner')
    )
  );

CREATE POLICY "phone_settings_write" ON phone_settings
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. push_sends — push notification log; staff read, admin/owner write
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE push_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_sends_read" ON push_sends
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

CREATE POLICY "push_sends_write" ON push_sends
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. drip_email_log — drip campaign send log; staff read only
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE drip_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drip_email_log_read" ON drip_email_log
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ops_email_log — transactional email log; staff read only
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_email_log_read" ON ops_email_log
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ops_recurring_templates — recurring job definitions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_recurring_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_recurring_templates_read" ON ops_recurring_templates
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

CREATE POLICY "ops_recurring_templates_write" ON ops_recurring_templates
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ops_recurrence_rules — scheduling rules for recurring templates
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_recurrence_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_recurrence_rules_read" ON ops_recurrence_rules
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

CREATE POLICY "ops_recurrence_rules_write" ON ops_recurrence_rules
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ops_batch_invoices — monthly consolidated invoices (Recovery Village)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_batch_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_batch_invoices_read" ON ops_batch_invoices
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

CREATE POLICY "ops_batch_invoices_write" ON ops_batch_invoices
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ops_batch_invoice_entries — line items inside a batch invoice
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_batch_invoice_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_batch_invoice_entries_read" ON ops_batch_invoice_entries
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

CREATE POLICY "ops_batch_invoice_entries_write" ON ops_batch_invoice_entries
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. ops_job_photos — job-site photos attached to appointments
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops_job_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops_job_photos_read" ON ops_job_photos
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech', 'marketing')
    )
  );

CREATE POLICY "ops_job_photos_write" ON ops_job_photos
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'dispatcher', 'tech')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. promotional_posts — marketing/promo posts
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE promotional_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "promotional_posts_read" ON promotional_posts
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'marketing')
    )
  );

CREATE POLICY "promotional_posts_write" ON promotional_posts
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'marketing')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. social_post_drafts — AI-generated social content awaiting approval
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE social_post_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_post_drafts_read" ON social_post_drafts
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'marketing')
    )
  );

CREATE POLICY "social_post_drafts_write" ON social_post_drafts
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM auth.users
      WHERE raw_user_meta_data->>'role' IN ('admin', 'owner', 'marketing')
    )
  );
