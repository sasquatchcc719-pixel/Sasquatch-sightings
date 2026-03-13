-- Update on_my_way_sms to include video link.
UPDATE ops_communication_templates
SET body_template = 'Charles from Sasquatch Carpet Cleaning is on the way and should arrive shortly! If anything changed with access, just reply. Here''s a quick video on what to expect: youtu.be/YfgMFxn7xhc'
WHERE template_key = 'on_my_way_sms';
