-- Fix hallucinated phone number (719) 358-6137 → correct business line (719) 249-8791
-- in all email templates stored in the database.
UPDATE ops_communication_templates
SET body_template = replace(body_template, '(719) 358-6137', '(719) 249-8791')
WHERE body_template LIKE '%(719) 358-6137%';
