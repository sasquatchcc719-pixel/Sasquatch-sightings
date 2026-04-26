-- Merge duplicate service addresses: same customer + same normalized street_1 + same zip (digits only).
-- Re-points ops_appointments and ops_recurring_templates to the kept row (oldest by created_at) before delete.
-- Job dates, times, and all appointment fields other than service_address_id are unchanged.

DO $$
DECLARE
  dup RECORD;
  min_id uuid;
BEGIN
  FOR dup IN
    SELECT
      customer_id,
      lower(trim(both ' ' from coalesce(street_1, ''))) AS norm_st,
      regexp_replace(replace(upper(coalesce(zip_code, '')), ' ', ''), '[^0-9]', '', 'g') AS norm_z
    FROM ops_service_addresses
    WHERE trim(both ' ' from coalesce(street_1, '')) <> ''
    GROUP BY
      customer_id,
      lower(trim(both ' ' from coalesce(street_1, ''))),
      regexp_replace(replace(upper(coalesce(zip_code, '')), ' ', ''), '[^0-9]', '', 'g')
    HAVING count(*) > 1
  LOOP
    SELECT id INTO min_id
    FROM ops_service_addresses
    WHERE customer_id = dup.customer_id
      AND lower(trim(both ' ' from coalesce(street_1, ''))) = dup.norm_st
      AND regexp_replace(replace(upper(coalesce(zip_code, '')), ' ', ''), '[^0-9]', '', 'g') = dup.norm_z
    ORDER BY created_at ASC
    LIMIT 1;

    IF min_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE ops_appointments
    SET service_address_id = min_id
    WHERE service_address_id IN (
      SELECT id
      FROM ops_service_addresses
      WHERE customer_id = dup.customer_id
        AND lower(trim(both ' ' from coalesce(street_1, ''))) = dup.norm_st
        AND regexp_replace(replace(upper(coalesce(zip_code, '')), ' ', ''), '[^0-9]', '', 'g') = dup.norm_z
        AND id <> min_id
    );

    UPDATE ops_recurring_templates
    SET service_address_id = min_id
    WHERE service_address_id IN (
      SELECT id
      FROM ops_service_addresses
      WHERE customer_id = dup.customer_id
        AND lower(trim(both ' ' from coalesce(street_1, ''))) = dup.norm_st
        AND regexp_replace(replace(upper(coalesce(zip_code, '')), ' ', ''), '[^0-9]', '', 'g') = dup.norm_z
        AND id <> min_id
    );

    DELETE FROM ops_service_addresses
    WHERE customer_id = dup.customer_id
      AND lower(trim(both ' ' from coalesce(street_1, ''))) = dup.norm_st
      AND regexp_replace(replace(upper(coalesce(zip_code, '')), ' ', ''), '[^0-9]', '', 'g') = dup.norm_z
      AND id <> min_id;
  END LOOP;
END;
$$;
