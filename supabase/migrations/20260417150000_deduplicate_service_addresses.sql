DO $$
DECLARE
  dup RECORD;
  min_id uuid;
BEGIN
  -- We group by customer_id and the lowercase, trimmed version of street_1
  FOR dup IN 
    SELECT customer_id, lower(trim(street_1)) as norm_st
    FROM ops_service_addresses
    GROUP BY customer_id, lower(trim(street_1))
    HAVING count(*) > 1
  LOOP
    -- Find the primary record we want to keep (the oldest one)
    SELECT id INTO min_id
    FROM ops_service_addresses
    WHERE customer_id = dup.customer_id AND lower(trim(street_1)) = dup.norm_st
    ORDER BY created_at ASC
    LIMIT 1;

    -- Re-point any appointments that used a duplicate
    UPDATE ops_appointments
    SET service_address_id = min_id
    WHERE service_address_id IN (
      SELECT id FROM ops_service_addresses
      WHERE customer_id = dup.customer_id AND lower(trim(street_1)) = dup.norm_st AND id != min_id
    );

    -- Re-point any recurring templates that used a duplicate
    UPDATE ops_recurring_templates
    SET service_address_id = min_id
    WHERE service_address_id IN (
      SELECT id FROM ops_service_addresses
      WHERE customer_id = dup.customer_id AND lower(trim(street_1)) = dup.norm_st AND id != min_id
    );

    -- Delete the duplicate addresses
    DELETE FROM ops_service_addresses
    WHERE customer_id = dup.customer_id AND lower(trim(street_1)) = dup.norm_st AND id != min_id;
  END LOOP;
END;
$$;
