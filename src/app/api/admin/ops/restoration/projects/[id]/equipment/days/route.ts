import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Correct the days a batch of equipment sat on the job.
 *
 * Equipment is entered after the fact more often than not — eight fans set on
 * Saturday, typed in on Monday between other jobs. The placement day is what
 * bills, so it has to be correctable, and correcting eight fans one at a time is
 * not something anybody will do twice.
 *
 * Ids come from the screen, which groups units that share a code and a pair of
 * dates, so one edit fixes the whole batch that went in together.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids is required' }, { status: 400 })
    }

    const patch: Record<string, string | null> = {}

    if ('placed_on' in body) {
      const placedOn = String(body.placed_on ?? '')
      if (!DATE.test(placedOn)) {
        return NextResponse.json({ error: 'placed_on must be a date' }, { status: 400 })
      }
      patch.placed_on = placedOn
    }

    if ('removed_on' in body) {
      const removedOn = body.removed_on == null ? null : String(body.removed_on)
      if (removedOn !== null && !DATE.test(removedOn)) {
        return NextResponse.json({ error: 'removed_on must be a date' }, { status: 400 })
      }
      // Putting a unit back on the job clears the day it came out, and the
      // trigger keeps removed_at in step.
      patch.removed_on = removedOn
      patch.removed_at = removedOn === null ? null : `${removedOn}T12:00:00`
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    if (
      patch.placed_on &&
      patch.removed_on &&
      String(patch.removed_on) < String(patch.placed_on)
    ) {
      return NextResponse.json(
        { error: 'equipment cannot come out before it went in' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('restoration_equipment_placements')
      .update(patch)
      .eq('project_id', id)
      .in('id', ids)
      .select('id, catalog_code, placed_on, removed_on')

    if (error) throw error
    return NextResponse.json({ updated: data?.length ?? 0, placements: data ?? [] })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update equipment days'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
