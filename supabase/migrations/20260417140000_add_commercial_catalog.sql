-- Insert Commercial services into the catalog
INSERT INTO service_catalog_items (
    id,
    name,
    description,
    category,
    base_price,
    pricing_model,
    pricing_unit,
    default_duration_minutes,
    buffer_minutes,
    is_active
) VALUES
(
    gen_random_uuid(),
    'Commercial Carpet Cleaning',
    'Hot water extraction for commercial glue-down or broadloom carpet',
    'Commercial',
    0.25,
    'variable',
    'sqft',
    60,
    0,
    true
),
(
    gen_random_uuid(),
    'Commercial Hard Floor Cleaning',
    'Scrub and clean for commercial VCT, tile, or concrete',
    'Commercial',
    0.35,
    'variable',
    'sqft',
    60,
    0,
    true
)
ON CONFLICT DO NOTHING;
