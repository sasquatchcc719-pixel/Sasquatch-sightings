# Supabase migrations (index)

Use this file to **search** for business logic that lives in SQL (humans and Cursor both).

| Migration | What it fixes |
|-----------|----------------|
| `20260723190000_add_image_url_to_chemical_products.sql` | Adds `chemical_products.image_url` — supplier product photo so techs visually match bottles on the truck. Auto-extracted by the Foreman spec scraper (og:image / catalog image). |
| `20260723170000_add_item_type_to_chemical_products.sql` | Adds `chemical_products.item_type` (`chemical` / `supply` / `equipment`) so the truck inventory can hold bonnets/pads and other gear the Foreman assistant can reference, not just chemistry. |
| `20260723150000_add_chemical_inventory.sql` | Adds `chemical_products` (truck chemical catalog for the Foreman field AI — scraped label/SDS specs are drafts until approved; only `in_stock` + `reviewed` rows are ever recommended) and `ai_diagnostic_logs` (audit log of field AI diagnoses). Service-role access only. |
| `20260702000000_add_quickbooks_item_id_to_service_catalog.sql` | Adds `service_catalog_items.quickbooks_item_id`. QuickBooks invoice sync (`src/lib/quickbooks-api.ts`) now resolves QB item refs by this id first (falling back to name lookup and self-caching the result here), so renaming a catalog item's display name no longer breaks its QuickBooks item mapping. |
| `20260701000000_raise_small_area_and_urine_prices.sql` | **Small Area / Walk-in Closet** (formerly "Hall/Bathroom/Closet") and **Urine Eliminator Treatment**: sets `service_catalog_items.base_price` to **$30** for both live booking slugs. Affects public `/api/public/services`, the website booking widget, and AI/catalog quoting. |
| `20260413120000_fix_pre_vacuuming_catalog_price.sql` | **Pre-Vacuuming** add-on: sets `service_catalog_items.base_price` to **$10**/room (was wrongly `0`; the `10` had been stored as duration). Affects public `/api/public/services` and anything reading catalog prices. |

**Apply to remote:** from repo root, `supabase db push` (requires linked project).

**Related (not in this folder):** the marketing site booking UI is the Angular **booking widget** in the separate `sasquatch.com-client` repo (`booking-widget.component.*`). It enforces the **$150 minimum** and corrects Pre-Vacuuming display if the API still lags.
