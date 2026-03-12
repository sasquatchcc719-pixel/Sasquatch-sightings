-- ============================================
-- OPERATIONS / BOOKING FOUNDATION
-- Internal-only replacement foundation for Housecall Pro
-- ============================================

CREATE TABLE IF NOT EXISTS staff_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'dispatcher', 'tech', 'marketing')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_catalog_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'cleaning',
  default_duration_minutes INTEGER NOT NULL CHECK (default_duration_minutes > 0),
  buffer_minutes INTEGER NOT NULL DEFAULT 15 CHECK (buffer_minutes >= 0),
  base_price DECIMAL(10, 2),
  pricing_unit TEXT NOT NULL DEFAULT 'fixed',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_area_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  city TEXT,
  zip_code TEXT,
  travel_buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (travel_buffer_minutes >= 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT service_area_rules_requires_city_or_zip CHECK (
    city IS NOT NULL OR zip_code IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS availability_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_user_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_interval_minutes > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT availability_templates_valid_window CHECK (start_time < end_time)
);

CREATE TABLE IF NOT EXISTS availability_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_user_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  override_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  is_available BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT availability_overrides_valid_window CHECK (
    (start_time IS NULL AND end_time IS NULL) OR
    (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE TABLE IF NOT EXISTS ops_customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  notes TEXT,
  quickbooks_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_service_addresses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES ops_customers(id) ON DELETE CASCADE NOT NULL,
  label TEXT DEFAULT 'Service Address',
  street_1 TEXT NOT NULL,
  street_2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'CO',
  zip_code TEXT NOT NULL,
  gate_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES ops_customers(id) ON DELETE RESTRICT NOT NULL,
  service_address_id UUID REFERENCES ops_service_addresses(id) ON DELETE RESTRICT NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  assigned_staff_user_id UUID REFERENCES staff_users(id) ON DELETE SET NULL,
  booking_channel TEXT NOT NULL DEFAULT 'admin',
  source TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'booked' CHECK (
    status IN ('booked', 'confirmed', 'on_my_way', 'in_progress', 'completed', 'cancelled')
  ),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (
    payment_status IN ('unpaid', 'partial', 'paid', 'waived')
  ),
  quickbooks_sync_status TEXT NOT NULL DEFAULT 'held' CHECK (
    quickbooks_sync_status IN ('held', 'pending', 'synced', 'failed')
  ),
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  quoted_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  internal_notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT appointments_valid_window CHECK (start_time < end_time)
);

CREATE TABLE IF NOT EXISTS ops_appointment_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID REFERENCES ops_appointments(id) ON DELETE CASCADE NOT NULL,
  service_catalog_item_id UUID REFERENCES service_catalog_items(id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  line_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_appointment_status_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID REFERENCES ops_appointments(id) ON DELETE CASCADE NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID REFERENCES ops_appointments(id) ON DELETE CASCADE NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'ready', 'sent', 'paid', 'void')
  ),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (
    payment_status IN ('unpaid', 'partial', 'paid', 'waived')
  ),
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  minimum_charge_adjustment DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  quickbooks_invoice_id TEXT,
  quickbooks_customer_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'held' CHECK (
    sync_status IN ('held', 'pending', 'synced', 'failed')
  ),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_invoice_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID REFERENCES ops_invoices(id) ON DELETE CASCADE NOT NULL,
  appointment_line_item_id UUID REFERENCES ops_appointment_line_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  line_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_invoice_status_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID REFERENCES ops_invoices(id) ON DELETE CASCADE NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_quickbooks_sync_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer', 'invoice')),
  entity_id UUID NOT NULL,
  sync_action TEXT NOT NULL DEFAULT 'upsert' CHECK (sync_action IN ('upsert')),
  status TEXT NOT NULL DEFAULT 'held' CHECK (
    status IN ('held', 'pending', 'synced', 'failed')
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_marketing_post_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID REFERENCES ops_appointments(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (
    status IN ('held', 'pending', 'draft_ready', 'approved', 'published')
  ),
  channels TEXT[] NOT NULL DEFAULT ARRAY['facebook', 'linkedin', 'google']::TEXT[],
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_users_user_id ON staff_users(user_id);
CREATE INDEX IF NOT EXISTS idx_service_catalog_items_active ON service_catalog_items(is_active);
CREATE INDEX IF NOT EXISTS idx_service_area_rules_lookup ON service_area_rules(city, zip_code);
CREATE INDEX IF NOT EXISTS idx_availability_templates_day ON availability_templates(day_of_week, is_active);
CREATE INDEX IF NOT EXISTS idx_availability_overrides_date ON availability_overrides(override_date);
CREATE INDEX IF NOT EXISTS idx_ops_customers_phone ON ops_customers(phone);
CREATE INDEX IF NOT EXISTS idx_ops_service_addresses_customer_id ON ops_service_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_ops_appointments_date_status ON ops_appointments(appointment_date, status);
CREATE INDEX IF NOT EXISTS idx_ops_appointments_assigned_staff ON ops_appointments(assigned_staff_user_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_ops_appointment_line_items_appointment_id ON ops_appointment_line_items(appointment_id);
CREATE INDEX IF NOT EXISTS idx_ops_invoices_status ON ops_invoices(status, payment_status);
CREATE INDEX IF NOT EXISTS idx_ops_quickbooks_sync_jobs_status ON ops_quickbooks_sync_jobs(status, entity_type);
CREATE INDEX IF NOT EXISTS idx_ops_marketing_post_queue_status ON ops_marketing_post_queue(status);

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT staff_users.role
      FROM staff_users
      WHERE staff_users.user_id = auth.uid()
        AND staff_users.is_active = true
      LIMIT 1
    ),
    (
      SELECT partners.role
      FROM partners
      WHERE partners.user_id = auth.uid()
      LIMIT 1
    ),
    CASE
      WHEN auth.uid() IS NOT NULL THEN 'admin'
      ELSE NULL
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.app_has_role(allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN current_app_role() = 'admin' THEN true
    ELSE current_app_role() = ANY(allowed_roles)
  END;
$$;

ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_area_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_service_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_appointment_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_appointment_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_invoice_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_quickbooks_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_marketing_post_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ops users can read own staff profile"
  ON staff_users FOR SELECT
  USING (auth.uid() = user_id OR app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Owner can manage staff users"
  ON staff_users FOR ALL
  USING (app_has_role(ARRAY['owner']))
  WITH CHECK (app_has_role(ARRAY['owner']));

CREATE POLICY "Ops users can read service catalog"
  ON service_catalog_items FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage service catalog"
  ON service_catalog_items FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read service area rules"
  ON service_area_rules FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage service area rules"
  ON service_area_rules FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read availability templates"
  ON availability_templates FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech']));

CREATE POLICY "Owner and dispatcher can manage availability templates"
  ON availability_templates FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read availability overrides"
  ON availability_overrides FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech']));

CREATE POLICY "Owner and dispatcher can manage availability overrides"
  ON availability_overrides FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read ops customers"
  ON ops_customers FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage ops customers"
  ON ops_customers FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read ops service addresses"
  ON ops_service_addresses FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage ops service addresses"
  ON ops_service_addresses FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read ops appointments"
  ON ops_appointments FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner dispatcher and tech can update ops appointments"
  ON ops_appointments FOR UPDATE
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher', 'tech']));

CREATE POLICY "Owner and dispatcher can insert ops appointments"
  ON ops_appointments FOR INSERT
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read ops appointment line items"
  ON ops_appointment_line_items FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage ops appointment line items"
  ON ops_appointment_line_items FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read ops appointment events"
  ON ops_appointment_status_events FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'tech', 'marketing']));

CREATE POLICY "Owner dispatcher and tech can insert ops appointment events"
  ON ops_appointment_status_events FOR INSERT
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher', 'tech']));

CREATE POLICY "Ops users can read ops invoices"
  ON ops_invoices FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage ops invoices"
  ON ops_invoices FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read ops invoice line items"
  ON ops_invoice_line_items FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'marketing']));

CREATE POLICY "Owner and dispatcher can manage ops invoice line items"
  ON ops_invoice_line_items FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read ops invoice events"
  ON ops_invoice_status_events FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'marketing']));

CREATE POLICY "Owner and dispatcher can insert ops invoice events"
  ON ops_invoice_status_events FOR INSERT
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Owner and dispatcher can read ops sync jobs"
  ON ops_quickbooks_sync_jobs FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Owner and dispatcher can manage ops sync jobs"
  ON ops_quickbooks_sync_jobs FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher']));

CREATE POLICY "Ops users can read ops marketing queue"
  ON ops_marketing_post_queue FOR SELECT
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'marketing']));

CREATE POLICY "Owner dispatcher and marketing can manage ops marketing queue"
  ON ops_marketing_post_queue FOR ALL
  USING (app_has_role(ARRAY['owner', 'dispatcher', 'marketing']))
  WITH CHECK (app_has_role(ARRAY['owner', 'dispatcher', 'marketing']));

COMMENT ON TABLE staff_users IS 'Internal staff access roles for operations, dispatch, technicians, and marketing';
COMMENT ON TABLE service_catalog_items IS 'Operational service catalog with pricing and default scheduling durations';
COMMENT ON TABLE ops_appointments IS 'Internal booking records that replace external scheduler handoff';
COMMENT ON TABLE ops_invoices IS 'Invoice drafts created at booking time and synced to QuickBooks later';
COMMENT ON TABLE ops_quickbooks_sync_jobs IS 'Queued QuickBooks Online sync work held until integration is enabled';
COMMENT ON TABLE ops_marketing_post_queue IS 'Deferred post-job marketing generation and publishing queue';
