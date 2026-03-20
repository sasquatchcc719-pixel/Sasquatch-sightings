-- ============================================
-- George Henderson: Read-only SQL query RPC
-- Allows George to run arbitrary SELECT queries
-- for business intelligence without write risk.
-- ============================================

CREATE OR REPLACE FUNCTION george_read_query(sql_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  normalized text;
BEGIN
  normalized := lower(trim(sql_query));

  -- Enforce read-only: must start with SELECT
  IF normalized !~ '^select' THEN
    RAISE EXCEPTION 'george_read_query: only SELECT statements are permitted';
  END IF;

  -- Block any mutation keywords inside the query
  IF normalized ~ '\y(insert|update|delete|drop|truncate|alter|create|grant|revoke|execute|perform)\y' THEN
    RAISE EXCEPTION 'george_read_query: mutation keywords are not permitted';
  END IF;

  EXECUTE format(
    'SELECT jsonb_agg(row_to_json(t)) FROM (%s) t',
    sql_query
  ) INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Only authenticated users can call this
REVOKE ALL ON FUNCTION george_read_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION george_read_query(text) TO authenticated;
GRANT EXECUTE ON FUNCTION george_read_query(text) TO service_role;
