-- Source: the NFC card's /tap/water-solutions municipal and private-well packages.
-- Retain existing catalog IDs; appointment/invoice price snapshots are untouched.
update public.service_catalog_items
set name = 'Municipal Water Assessment — Existing Appointment',
    base_price = 149,
    description = 'Water sample collection during your existing cleaning appointment. Includes one sampling location, mineral testing, review of your utility water report, and help understanding the results. Additional locations, specialty testing, equipment and installation are quoted separately.',
    updated_at = now()
where slug = 'water-collection-lab-testing-existing-appointment'
  and category = 'Water Treatment';

update public.service_catalog_items
set name = 'Municipal Water Assessment — Separate Visit',
    base_price = 224,
    description = 'Municipal Water Assessment with a dedicated collection visit: $149 assessment plus $75 visit. Includes one sampling location, mineral testing, review of your utility water report, and help understanding the results. Additional locations, specialty testing, equipment and installation are quoted separately.',
    updated_at = now()
where slug = 'water-collection-lab-testing-separate-visit'
  and category = 'Water Treatment';

insert into public.service_catalog_items (
  name, slug, description, category, base_price, pricing_unit,
  buffer_minutes, is_active, online_booking_enabled, sort_order
) values
  (
    'Private Well Testing — Existing Appointment',
    'private-well-testing-existing-appointment',
    'Water sample collection during your existing cleaning appointment. Includes one sampling location, laboratory testing for bacteria, minerals and selected metals including lead and arsenic, sample handling and shipping, and help understanding the results. Typical laboratory turnaround is 8–10 business days plus shipping. Additional locations, specialty testing, equipment and installation are quoted separately.',
    'Water Treatment', 349, 'fixed', 30, true, false, 504
  ),
  (
    'Private Well Testing — Separate Visit',
    'private-well-testing-separate-visit',
    'Private Well Testing with a dedicated collection visit: $349 testing plus $75 visit. Includes one sampling location, laboratory testing for bacteria, minerals and selected metals including lead and arsenic, sample handling and shipping, and help understanding the results. Typical laboratory turnaround is 8–10 business days plus shipping. Additional locations, specialty testing, equipment and installation are quoted separately.',
    'Water Treatment', 424, 'fixed', 30, true, false, 505
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  base_price = excluded.base_price,
  updated_at = now();
