// @vitest-environment node
/**
 * Variant resolution against the REAL catalog.
 *
 * The line-entry test covers the same ground through a live language model,
 * which makes it a poor place to assert exact codes — the model occasionally
 * hears "removing carpet" as something else, and the failure looks like a
 * pricing bug when it is nothing of the kind. The pricing property is
 * deterministic, so it is asserted deterministically here.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { loadEnabledCatalog } from '@/lib/ops/restoration-line-entry'
import { resolveVariant, type RestorationCatalogItem } from '@/lib/ops/restoration-catalog'

const supabase = createAdminClient()
let items: RestorationCatalogItem[] = []

beforeAll(async () => {
  items = await loadEnabledCatalog(supabase)
  expect(items.length).toBeGreaterThan(0)
})

describe('the real catalog prices a contaminated loss higher', () => {
  it('sends carpet tear-out to the Category 3 rate', () => {
    const cat1 = resolveVariant(items, 'FCC', { waterCategory: 1, afterHours: false })
    const cat3 = resolveVariant(items, 'FCC', { waterCategory: 3, afterHours: false })
    expect(cat1?.code).toBe('FCC')
    expect(cat3?.code).toBe('FCCS')
    expect(Number(cat3!.unit_price)).toBeGreaterThan(Number(cat1!.unit_price))
  })

  it('does the same for pad and tack strip', () => {
    expect(
      resolveVariant(items, 'PAD', { waterCategory: 3, afterHours: false })?.code,
    ).toBe('PADS')
    expect(
      resolveVariant(items, 'TACK', { waterCategory: 3, afterHours: false })?.code,
    ).toBe('TACKS')
  })

  it('leaves a concept with no Category 3 variant on its base rate', () => {
    // Anti-microbial has one price. It must stay put rather than being pushed
    // onto some other item that happens to have a Cat 3 row.
    const hit = resolveVariant(items, 'GRM', { waterCategory: 3, afterHours: false })
    expect(hit?.code).toBe('GRM')
    expect(Number(hit!.unit_price)).toBeCloseTo(0.34, 2)
  })

  it('combines contamination with after hours, keeping the category', () => {
    // Both modifiers apply and neither cancels the other: the contamination is
    // a fact about the job, so it survives the after-hours variant.
    const cat3 = resolveVariant(items, 'FCC', { waterCategory: 3, afterHours: false })
    const hit = resolveVariant(items, 'FCC', { waterCategory: 3, afterHours: true })
    expect(hit?.code).toBe('FCCSA')
    expect(Number(hit!.unit_price)).toBeGreaterThan(Number(cat3!.unit_price))
  })
})
