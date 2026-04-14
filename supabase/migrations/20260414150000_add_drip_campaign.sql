-- Drip email campaign tables

-- 1. Editable templates for each drip step
CREATE TABLE IF NOT EXISTS drip_email_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  step_index int NOT NULL UNIQUE,
  label text NOT NULL,
  delay_days int NOT NULL,
  subject_template text NOT NULL,
  body_template text NOT NULL,
  is_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed the 4 default templates
INSERT INTO drip_email_templates (step_index, label, delay_days, subject_template, body_template) VALUES
(0, '3-Day Satisfaction Check-in', 3,
 'Hi {{first_name}}, how are the floors looking?',
 E'Hi {{first_name}},\n\nIt''s been a few days since we were at your home! We wanted to quickly check in and make sure your floors are still looking legendary.\n\nIf any spots have resurfaced or if you have any questions, please just hit reply and let us know — we want to make sure you''re 100% happy.\n\nThe Sasquatch ''20 & 20'' Reward: Since we love working with neighbors like you, we wanted to offer a little something back. If you know anyone in {{city}} who needs a refresh:\n\nTHEY get $20 OFF their first cleaning.\n\nYOU get a $20 CREDIT toward your next service for every friend who books!\n\nThey just need to mention your name when they call, or you can send them our booking link: just make sure they put REF20 in the note section so we can track it.\n\nStay legendary,\nCharles. Sasquatch Carpet Cleaning'),

(1, '1-Month Cross-Sell', 30,
 'The Sasquatch secret to a totally clean home',
 E'Hi {{first_name}},\n\nWe hope you''re still loving your freshly cleaned carpets!\n\nNow that the floors are looking legendary, have you noticed if your favorite sofa or that high-traffic tile is starting to look a little tired?\n\nMost people don''t realize that upholstery and tile actually trap just as much dust and allergens as carpets do. Since we were just at your home last month, we''d love to help you finish the job:\n\nUpholstery Refresh: Remove stains and odors from your favorite couch.\n\nTile & Grout Deep Clean: Make your kitchen or bath sparkle like new.\n\nArea Rug Revival: Professional care for your delicate rugs.\n\nThe neighbor-only deal: Book any of these ''add-on'' services this week and take $20 OFF as a thank you! MY20 in notes\n\nView our other services & book\n\nStay legendary,\nCharles, Sasquatch Carpet Cleaning'),

(2, '6-Month Re-engagement', 180,
 '{{first_name}}, your carpets are due for a refresh',
 E'Hi {{first_name}},\n\nIt''s been about six months since we cleaned your floors, and we wanted to check in.\n\nAt the six-month mark, carpets start holding onto dust, allergens, and everyday grime that vacuuming alone can''t reach — especially here in Colorado with our dry air and mountain dust.\n\nMost of our Tri-Lakes neighbors book a refresh around this time to keep their home feeling fresh and extend the life of their carpet.\n\nWe''d love to get you back on the schedule. Book online and we''ll take care of the rest:\n\nStay legendary,\nCharles, Sasquatch Carpet Cleaning'),

(3, '12-Month Win-Back', 365,
 'It''s been a year... is it time for a Sasquatch sighting?',
 E'Hi {{first_name}},\n\nIt''s been over a year since we last cleaned your floors, and we''ve really missed being your neighborhood carpet experts!\n\nUsually, after 12 months, carpets start to lose that ''legendary'' feel and begin trapping the mountain dust and allergens that come with living in Colorado. We''d love to help you get that fresh-start feeling back.\n\nThe ''Hail Mary'' Offer: Since it''s been a while, we want to make it easy for you to come back to the Sasquatch family. Book any service this month and take $30 OFF your total.\n\nWe only have a few spots left for the next two weeks. You can grab one instantly here:\n\nWe hope to see you again soon!\n\nStay legendary,\nCharles Sasquatch Carpet Cleaning')
ON CONFLICT (step_index) DO NOTHING;

-- 2. Enrollment tracking
CREATE TABLE IF NOT EXISTS drip_campaign_enrollments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES ops_customers(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES ops_appointments(id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  current_step int NOT NULL DEFAULT 0,
  next_send_at date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'unsubscribed', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drip_enrollments_next_send
  ON drip_campaign_enrollments (next_send_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_drip_enrollments_customer
  ON drip_campaign_enrollments (customer_id);

-- 3. Send log
CREATE TABLE IF NOT EXISTS drip_email_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES drip_campaign_enrollments(id) ON DELETE CASCADE,
  step int NOT NULL,
  template_label text,
  subject text,
  to_email text,
  resend_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message text,
  sent_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drip_email_log_enrollment
  ON drip_email_log (enrollment_id);

-- 4. Opt-out column
ALTER TABLE ops_customers
  ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false;
