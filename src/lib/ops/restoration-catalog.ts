/**
 * Restoration (Xactimate WTR) catalog resolution.
 *
 * The catalog stores every Category 1/2/3, after-hours, and heavy variant of a
 * line item as its own row, grouped by `concept_code` (the Xactimate code stem).
 * `EXT` for example groups all twelve extraction variants from $0.58 to $2.52.
 *
 * The rule this module exists to enforce: **nothing that guesses may choose a
 * price.** Voice/text entry identifies a CONCEPT ("remove carpet"); the loss
 * context on the project — water category, time of call — deterministically
 * resolves which variant that is. A language model never picks between FCC at
 * $0.76 and FCCS at $1.10.
 */

export type WaterCategory = 1 | 2 | 3

export type RestorationCatalogItem = {
  id: string
  code: string
  description: string
  unit: 'SF' | 'LF' | 'EA' | 'DA' | 'HR' | 'CF' | 'GL' | 'WK'
  unit_price: number
  water_category: 2 | 3 | null
  after_hours: boolean
  is_heavy: boolean
  concept_code: string
  concept_label: string
  is_enabled: boolean
  quickbooks_item_id: string | null
}

export type LossContext = {
  waterCategory: WaterCategory
  afterHours: boolean
  heavy?: boolean
}

/** Catalog rows store null for Category 1 / unspecified. */
export function categoryOf(item: RestorationCatalogItem): WaterCategory {
  return (item.water_category ?? 1) as WaterCategory
}

/**
 * Resolution attempts, most specific first. Each step relaxes one dimension so a
 * concept that has no exact variant still resolves rather than dead-ending at a
 * loss site.
 *
 * Order matters and is deliberate: **water category is relaxed LAST**. It is the
 * largest price driver (Cat 3 extraction is 2.5x Cat 1) and a contamination fact
 * about the job, whereas after-hours and heavy are modifiers. Relaxing category
 * first would bill Cat 3 work at clean-water rates, which is the exact failure
 * this catalog exists to prevent.
 */
function candidatePreferences(ctx: LossContext): Array<{
  category: WaterCategory
  afterHours: boolean
  heavy: boolean
}> {
  const heavyPrefs = ctx.heavy ? [true, false] : [false]
  const afterHoursPrefs = ctx.afterHours ? [true, false] : [false]

  const prefs: Array<{ category: WaterCategory; afterHours: boolean; heavy: boolean }> = []
  for (let category = ctx.waterCategory; category >= 1; category--) {
    for (const afterHours of afterHoursPrefs) {
      for (const heavy of heavyPrefs) {
        prefs.push({ category: category as WaterCategory, afterHours, heavy })
      }
    }
  }
  return prefs
}

/**
 * Pick the correct variant of a concept for the loss context.
 * Returns null only when the concept has no items at all.
 */
export function resolveVariant(
  items: RestorationCatalogItem[],
  conceptCode: string,
  ctx: LossContext,
): RestorationCatalogItem | null {
  const pool = items.filter(
    (i) => i.concept_code === conceptCode && i.is_enabled,
  )
  if (pool.length === 0) return null

  for (const pref of candidatePreferences(ctx)) {
    const hit = pool.find(
      (i) =>
        categoryOf(i) === pref.category &&
        i.after_hours === pref.afterHours &&
        i.is_heavy === pref.heavy,
    )
    if (hit) return hit
  }

  // Nothing matched the preference ladder — fall back to the plainest variant
  // (Cat 1, business hours, not heavy) so entry never dead-ends.
  const plain = pool.find(
    (i) => categoryOf(i) === 1 && !i.after_hours && !i.is_heavy,
  )
  return plain ?? pool[0]
}

/**
 * Concepts offered to the line-item picker and to voice extraction: one entry
 * per distinct piece of work, not one per price variant. Collapses 560 rows to
 * roughly 330 choices.
 */
export function listConcepts(
  items: RestorationCatalogItem[],
): Array<{ conceptCode: string; label: string; unit: string }> {
  const seen = new Map<string, { conceptCode: string; label: string; unit: string }>()
  for (const item of items) {
    if (!item.is_enabled) continue
    if (seen.has(item.concept_code)) continue
    seen.set(item.concept_code, {
      conceptCode: item.concept_code,
      label: item.concept_label,
      unit: item.unit,
    })
  }
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * An item may only reach an invoice once it has a QuickBooks item to sync to.
 * Enforced here rather than as a table constraint so a missing mapping never
 * blocks work mid-job — it surfaces as a fixable warning instead.
 */
export function isBillable(item: RestorationCatalogItem): boolean {
  return item.is_enabled && Boolean(item.quickbooks_item_id)
}

export function unmappedEnabledItems(
  items: RestorationCatalogItem[],
): RestorationCatalogItem[] {
  return items.filter((i) => i.is_enabled && !i.quickbooks_item_id)
}

/**
 * Water category in effect at a point in time. Under IICRC S500 a Category 1
 * loss degrades to Category 2 after roughly 48 hours and to Category 3 with
 * further time or contamination, so work performed on day 3 may bill at a
 * different category than work performed on day 1.
 */
export function categoryAt(
  events: Array<{ water_category: number; effective_at: string }>,
  when: Date,
  fallback: WaterCategory = 1,
): WaterCategory {
  const applicable = events
    .filter((e) => new Date(e.effective_at).getTime() <= when.getTime())
    .sort(
      (a, b) =>
        new Date(b.effective_at).getTime() - new Date(a.effective_at).getTime(),
    )
  return (applicable[0]?.water_category as WaterCategory) ?? fallback
}
