import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadEnabledCatalog } from '@/lib/ops/restoration-line-entry'
import { resolveVariant, type WaterCategory } from '@/lib/ops/restoration-catalog'

/**
 * The line-item picker: one entry per kind of work, already priced for this
 * loss. Cat 1/2/3 and after-hours never appear as separate choices — the
 * project context decides which variant a concept resolves to.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)

    const category = (Number(searchParams.get('category') ?? 1) || 1) as WaterCategory
    const afterHours = searchParams.get('after_hours') === 'true'
    const query = (searchParams.get('q') ?? '').trim().toLowerCase()

    const items = await loadEnabledCatalog(supabase)
    const concepts = new Map<string, { code: string; label: string }>()
    for (const item of items) {
      if (!concepts.has(item.concept_code)) {
        concepts.set(item.concept_code, {
          code: item.concept_code,
          label: item.concept_label,
        })
      }
    }

    const results = []
    for (const concept of concepts.values()) {
      const hit = resolveVariant(items, concept.code, {
        waterCategory: category,
        afterHours,
      })
      if (!hit) continue
      if (
        query &&
        !concept.label.toLowerCase().includes(query) &&
        !hit.code.toLowerCase().includes(query)
      ) {
        continue
      }
      results.push({
        concept_code: concept.code,
        label: concept.label,
        code: hit.code,
        description: hit.description,
        unit: hit.unit,
        unit_price: hit.unit_price,
        billable: Boolean(hit.quickbooks_item_id),
      })
    }

    results.sort((a, b) => a.label.localeCompare(b.label))
    return NextResponse.json({ items: results })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load catalog'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
