-- Post-job thank-you email: align copy with legacy Zapier / Housecall Pro flow.
-- Merge fields use {{first_name}}, {{company_name}} (see src/lib/ops/communications.ts).
UPDATE ops_communication_templates
SET
  label = 'Finished job email',
  subject_template = 'Thank you from {{company_name}} — care tips & review',
  body_template = $BODY$
Hi {{first_name}},

Thank you for choosing {{company_name}}! It was a pleasure serving you today and providing a Legendary Clean for your home.

Post-Cleaning Care & Dry Times:

- Dry Time: While every home is different, carpets generally take 12 to 24 hours to dry completely. We recommend waiting the full 24 hours before moving heavy furniture back or walking on it with outdoor shoes.

- Airflow is Key: To speed things up, move air across the carpet fibers at floor level using ceiling fans or floor fans. Good airflow can sometimes drop dry times to just a few hours!

- Safety First: Please be extra careful when walking from the damp carpet onto hard surfaces like tile or wood—it will be very slippery!

A Small Favor? As a local business, your feedback helps the Sasquatch grow! If you are thrilled with your clean, would you mind leaving us a quick review?

Leave a review here:
https://www.sasquatchcarpet.com/reviews

If anything is not 100% legendary, text Harry at (719) 249-8791 and we will make it right.

Thanks again for the business!
— {{company_name}}
$BODY$
WHERE template_key = 'job_finished_email';
