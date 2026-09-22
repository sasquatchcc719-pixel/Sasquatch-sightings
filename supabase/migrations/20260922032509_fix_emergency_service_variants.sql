-- ESRV and ESRVD are the after-hours/daytime prices for one kind of work.
-- The original catalog import treated them as separate concepts and left both
-- with after_hours=false, so an after-hours job could resolve to the daytime
-- charge. Keep the Xactimate codes, prices, enabled state, and QuickBooks links.
update public.restoration_catalog_items
set
  concept_code = 'ESRVD',
  concept_label = 'Emergency service call',
  after_hours = (code = 'ESRV'),
  updated_at = now()
where code in ('ESRV', 'ESRVD')
  and (
    concept_code is distinct from 'ESRVD'
    or concept_label is distinct from 'Emergency service call'
    or after_hours is distinct from (code = 'ESRV')
  );
