-- Audit log for deleted records
-- Captures the full row as JSONB before any DELETE on key tables.
-- Works at the database level -- protects against all clients (Harry, Claudesquatch, direct queries, etc.)

CREATE TABLE IF NOT EXISTS ops_deleted_records (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name  TEXT        NOT NULL,
  record_id   UUID        NOT NULL,
  record_data JSONB       NOT NULL,
  deleted_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by table + record
CREATE INDEX IF NOT EXISTS idx_deleted_records_table_record
  ON ops_deleted_records (table_name, record_id);

-- Trigger function: captures old row into audit log before deletion
CREATE OR REPLACE FUNCTION fn_log_deleted_record()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ops_deleted_records (table_name, record_id, record_data)
  VALUES (TG_TABLE_NAME, OLD.id, row_to_json(OLD)::jsonb);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Apply to appointments
DROP TRIGGER IF EXISTS trg_log_deleted_appointment ON ops_appointments;
CREATE TRIGGER trg_log_deleted_appointment
  BEFORE DELETE ON ops_appointments
  FOR EACH ROW EXECUTE FUNCTION fn_log_deleted_record();

-- Apply to customers
DROP TRIGGER IF EXISTS trg_log_deleted_customer ON ops_customers;
CREATE TRIGGER trg_log_deleted_customer
  BEFORE DELETE ON ops_customers
  FOR EACH ROW EXECUTE FUNCTION fn_log_deleted_record();

-- Apply to service addresses
DROP TRIGGER IF EXISTS trg_log_deleted_address ON ops_service_addresses;
CREATE TRIGGER trg_log_deleted_address
  BEFORE DELETE ON ops_service_addresses
  FOR EACH ROW EXECUTE FUNCTION fn_log_deleted_record();
