-- Batch RPC to return aggregated stats per customer for the customers directory
CREATE OR REPLACE FUNCTION get_customer_stats_batch(customer_ids UUID[])
RETURNS TABLE (
  customer_id UUID,
  job_count INT,
  last_job_date DATE,
  total_revenue NUMERIC,
  lead_source TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.customer_id,
    COUNT(*)::int AS job_count,
    MAX(a.appointment_date) AS last_job_date,
    COALESCE(SUM(i.total) FILTER (WHERE i.payment_status = 'paid'), 0) AS total_revenue,
    (array_agg(DISTINCT a.lead_source) FILTER (WHERE a.lead_source IS NOT NULL))[1] AS lead_source
  FROM ops_appointments a
  LEFT JOIN ops_invoices i ON i.appointment_id = a.id
  WHERE a.customer_id = ANY(customer_ids)
  GROUP BY a.customer_id;
$$;
