-- Safety Data Sheets (SDS, formerly "MSDS") per chemical. OSHA HazCom requires
-- the SDS be readily accessible to techs in the field — this is the digital
-- version of the binder that used to live under the truck seat.
--   sds_url      - link to the manufacturer's OFFICIAL SDS (authoritative source)
--   sds_file_url - public URL of an uploaded PDF copy in storage (offline copy,
--                  so it opens even if the manufacturer link rots). Uploaded at
--                  /admin/chemicals; served under the job-images bucket's
--                  chemical-sds/ prefix.
-- The field inventory "Open SDS" button prefers the uploaded copy, falling
-- back to the manufacturer link.
-- NOTE: an SDS is a legal manufacturer document — it is never AI-generated.
-- The spec scraper may only capture a link to the real sheet.

alter table chemical_products
  add column if not exists sds_url text,
  add column if not exists sds_file_url text;
