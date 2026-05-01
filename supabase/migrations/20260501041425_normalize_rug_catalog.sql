-- Normalize public rug cleaning catalog labels, descriptions, units, and order.

UPDATE service_catalog_items
SET
  name = updates.name,
  description = updates.description,
  base_price = updates.base_price,
  pricing_unit = updates.pricing_unit,
  sort_order = updates.sort_order,
  updated_at = NOW()
FROM (
  VALUES
    (
      'rug-3x5',
      'Area Rug 3x5',
      'Professional area rug cleaning for a 3x5 rug. Removes soil, allergens, and odors while helping restore color and freshness.',
      12.00,
      'per rug',
      430
    ),
    (
      'runner-2-5x8',
      'Runner Rug 2.5x8',
      'Professional runner rug cleaning for a 2.5x8 runner. Removes soil, allergens, and odors while helping restore color and freshness.',
      20.00,
      'per rug',
      440
    ),
    (
      'rug-4x6-wool-or-polyester',
      'Area Rug 4x6',
      'Professional area rug cleaning for a 4x6 rug. Removes soil, allergens, and odors while helping restore color and freshness.',
      20.00,
      'per rug',
      450
    ),
    (
      'rug-5x6',
      'Area Rug 5x6',
      'Professional area rug cleaning for a 5x6 rug. Removes soil, allergens, and odors while helping restore color and freshness.',
      25.00,
      'per rug',
      460
    ),
    (
      'area-rug-8x5',
      'Area Rug 5x8',
      'Professional area rug cleaning for a 5x8 rug. Removes soil, allergens, and odors while helping restore color and freshness.',
      32.00,
      'per rug',
      470
    ),
    (
      'rug-8x11wool-or-polyester',
      'Area Rug 8x11',
      'Professional area rug cleaning for an 8x11 rug. Removes soil, allergens, and odors while helping restore color and freshness.',
      70.00,
      'per rug',
      480
    ),
    (
      'rug-11x14',
      'Area Rug 11x14',
      'Professional area rug cleaning for an 11x14 rug. Removes soil, allergens, and odors while helping restore color and freshness.',
      120.00,
      'per rug',
      490
    ),
    (
      'rug-cleaning-per-foot',
      'Custom-Size Area Rug Cleaning',
      'Custom-size area rug cleaning priced per square foot. Best for rugs that do not match the standard sizes listed above.',
      0.80,
      'per_sq_ft',
      500
    )
) AS updates(slug, name, description, base_price, pricing_unit, sort_order)
WHERE service_catalog_items.slug = updates.slug
  AND service_catalog_items.category = 'rug cleaning';
