# Supabase migrations (index)

Use this file to **search** for business logic that lives in SQL (humans and Cursor both).

| Migration | What it fixes |
|-----------|----------------|
| `20260702000000_add_quickbooks_item_id_to_service_catalog.sql` | Adds `service_catalog_items.quickbooks_item_id`. QuickBooks invoice sync (`src/lib/quickbooks-api.ts`) now resolves QB item refs by this id first (falling back to name lookup and self-caching the result here), so renaming a catalog item's display name no longer breaks its QuickBooks item mapping. |
| `20260701000000_raise_small_area_and_urine_prices.sql` | **Small Area / Walk-in Closet** (formerly "Hall/Bathroom/Closet") and **Urine Eliminator Treatment**: sets `service_catalog_items.base_price` to **$30** for both live booking slugs. Affects public `/api/public/services`, the website booking widget, and AI/catalog quoting. |
| `20260413120000_fix_pre_vacuuming_catalog_price.sql` | **Pre-Vacuuming** add-on: sets `service_catalog_items.base_price` to **$10**/room (was wrongly `0`; the `10` had been stored as duration). Affects public `/api/public/services` and anything reading catalog prices. |

**Apply to remote:** from repo root, `supabase db push` (requires linked project).

**Related (not in this folder):** the marketing site booking UI is the Angular **booking widget** in the separate `sasquatch.com-client` repo (`booking-widget.component.*`). It enforces the **$150 minimum** and corrects Pre-Vacuuming display if the API still lags.
