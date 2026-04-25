-- Remove Linktree from post-job email; use main site reviews page (matches satisfaction_checkin, SMS).
UPDATE ops_communication_templates
SET
  body_template = replace(
    body_template,
    'https://linktr.ee/sasquatchcc719',
    'https://www.sasquatchcarpet.com/reviews'
  )
WHERE
  template_key = 'job_finished_email'
  AND body_template IS NOT NULL
  AND position('https://linktr.ee/sasquatchcc719' in body_template) > 0;
