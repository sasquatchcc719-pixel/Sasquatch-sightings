-- Recurring job templates: the "what" of a recurring job
CREATE TABLE IF NOT EXISTS ops_recurring_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES ops_customers(id) ON DELETE CASCADE,
  service_address_id UUID NOT NULL REFERENCES ops_service_addresses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]',
  start_time TIME NOT NULL DEFAULT '09:00',
  scheduled_duration_minutes INT NOT NULL DEFAULT 120,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  internal_notes TEXT,
  invoice_mode TEXT NOT NULL DEFAULT 'per_visit'
    CHECK (invoice_mode IN ('per_visit', 'batch_monthly')),
  booking_channel TEXT NOT NULL DEFAULT 'recurring',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recurrence rules: the "when" of a recurring job (one template can have multiple rules)
CREATE TABLE IF NOT EXISTS ops_recurrence_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES ops_recurring_templates(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'custom')),
  day_of_week INT CHECK (day_of_week >= 0 AND day_of_week <= 6),
  week_of_month INT CHECK (week_of_month >= 1 AND week_of_month <= 5),
  day_of_month INT CHECK (day_of_month >= 1 AND day_of_month <= 31),
  interval_days INT CHECK (interval_days > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until DATE,
  override_start_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link generated appointments back to their template
ALTER TABLE ops_appointments
  ADD COLUMN IF NOT EXISTS recurring_template_id UUID REFERENCES ops_recurring_templates(id) ON DELETE SET NULL;

-- Batch invoices for monthly consolidation (Recovery Village)
CREATE TABLE IF NOT EXISTS ops_batch_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES ops_recurring_templates(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES ops_customers(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'sent', 'paid', 'void')),
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  quickbooks_invoice_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Entries linking appointments to a batch invoice
CREATE TABLE IF NOT EXISTS ops_batch_invoice_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_invoice_id UUID NOT NULL REFERENCES ops_batch_invoices(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES ops_appointments(id) ON DELETE CASCADE,
  line_items_snapshot JSONB NOT NULL DEFAULT '[]',
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_recurrence_rules_template ON ops_recurrence_rules(template_id);
CREATE INDEX IF NOT EXISTS idx_appointments_recurring_template ON ops_appointments(recurring_template_id) WHERE recurring_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_batch_invoices_customer_month ON ops_batch_invoices(customer_id, month);
CREATE INDEX IF NOT EXISTS idx_batch_invoice_entries_batch ON ops_batch_invoice_entries(batch_invoice_id);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_active ON ops_recurring_templates(is_active) WHERE is_active = true;
