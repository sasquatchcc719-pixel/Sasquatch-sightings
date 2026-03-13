-- Add review link to job finished SMS template.
UPDATE ops_communication_templates
SET body_template = 'Thanks {{first_name}}, we appreciate your business and hope you love the clean! If anything needs attention, just reply and we will make it right. If you loved the results, a quick review means the world to us: sasquatchcarpet.com/reviews'
WHERE template_key = 'job_finished_sms';
