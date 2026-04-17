-- Invoice numbers for QuickBooks DocNumber and internal records.
--
-- QuickBooks "Custom transaction numbers" requires a DocNumber on every
-- invoice. We assign a shared sequential number across ops_invoices and
-- ops_batch_invoices so every invoice in the business has a unique, stable
-- identifier for the books.

CREATE SEQUENCE IF NOT EXISTS sasquatch_invoice_number_seq
  START WITH 1001
  INCREMENT BY 1
  MINVALUE 1001
  NO MAXVALUE
  CACHE 1;

ALTER TABLE ops_invoices
  ADD COLUMN IF NOT EXISTS invoice_number BIGINT UNIQUE;

ALTER TABLE ops_batch_invoices
  ADD COLUMN IF NOT EXISTS invoice_number BIGINT UNIQUE;

-- Auto-assign on insert if not provided
CREATE OR REPLACE FUNCTION assign_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := nextval('sasquatch_invoice_number_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ops_invoices_assign_number ON ops_invoices;
CREATE TRIGGER trg_ops_invoices_assign_number
  BEFORE INSERT ON ops_invoices
  FOR EACH ROW
  EXECUTE FUNCTION assign_invoice_number();

DROP TRIGGER IF EXISTS trg_ops_batch_invoices_assign_number ON ops_batch_invoices;
CREATE TRIGGER trg_ops_batch_invoices_assign_number
  BEFORE INSERT ON ops_batch_invoices
  FOR EACH ROW
  EXECUTE FUNCTION assign_invoice_number();

-- Backfill existing rows in creation order so numbering is chronological
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT id, created_at, 'ops_invoices'::text AS tbl FROM ops_invoices WHERE invoice_number IS NULL
    UNION ALL
    SELECT id, created_at, 'ops_batch_invoices'::text AS tbl FROM ops_batch_invoices WHERE invoice_number IS NULL
    ORDER BY created_at ASC
  ) LOOP
    IF r.tbl = 'ops_invoices' THEN
      UPDATE ops_invoices SET invoice_number = nextval('sasquatch_invoice_number_seq') WHERE id = r.id;
    ELSE
      UPDATE ops_batch_invoices SET invoice_number = nextval('sasquatch_invoice_number_seq') WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_ops_invoices_invoice_number ON ops_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_ops_batch_invoices_invoice_number ON ops_batch_invoices(invoice_number);
