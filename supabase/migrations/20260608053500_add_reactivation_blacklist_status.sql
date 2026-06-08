-- Suppress blacklisted customers from the reactivation email pool.

ALTER TABLE reactivation_campaign_enrollments
  DROP CONSTRAINT IF EXISTS reactivation_campaign_enrollments_status_check;

ALTER TABLE reactivation_campaign_enrollments
  ADD CONSTRAINT reactivation_campaign_enrollments_status_check CHECK (
    status IN (
      'active',
      'eligible',
      'paused_recent_booking',
      'post_job_drip',
      'suppressed_manual',
      'suppressed_blacklisted',
      'suppressed_unsubscribed',
      'suppressed_bounced',
      'excluded_no_email',
      'excluded_duplicate'
    )
  );
