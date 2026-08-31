import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

import type { SupabaseClient } from '@supabase/supabase-js'

const round2 = (n: number) => Math.round(n * 100) / 100

function positive(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * A signed estimate stops moving, whichever end you push on it. The add route
 * already refuses; without the same check here a line could still be edited or
 * deleted out from under a signature, which would make the signature worthless.
 */
async function frozen(supabase: SupabaseClient, projectId: string) {
  const { data } = await supabase
    .from('restoration_projects')
    .select('estimate_signed_at')
    .eq('id', projectId)
    .maybeSingle()
  return Boolean(data?.estimate_signed_at)
}

/**
 * Adjust a line. The price comes from the catalog, never the client.
 *
 * Equipment takes `units` and `days` — eight air movers for three days — and the
 * quantity follows from them. Everything else takes a quantity directly.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ lineId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { lineId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const { data: line } = await supabase
      .from('restoration_estimate_lines')
      .select('id, project_id, unit_price, quantity, units, days')
      .eq('id', lineId)
      .maybeSingle()
    if (!line) return NextResponse.json({ error: 'line_not_found' }, { status: 404 })
    if (await frozen(supabase, line.project_id)) {
      return NextResponse.json({ error: 'estimate_already_signed' }, { status: 409 })
    }

    const isDaily = line.units != null || body.units != null
    let update: Record<string, number>

    if (isDaily) {
      const units = positive(body.units) ?? positive(line.units)
      const days = positive(body.days) ?? positive(line.days) ?? 1
      if (units == null) {
        return NextResponse.json({ error: 'units must be greater than zero' }, { status: 400 })
      }
      const quantity = units * days
      update = {
        units,
        days,
        quantity,
        line_total: round2(quantity * Number(line.unit_price)),
      }
    } else {
      const quantity = positive(body.quantity)
      if (quantity == null) {
        return NextResponse.json({ error: 'quantity must be greater than zero' }, { status: 400 })
      }
      update = { quantity, line_total: round2(quantity * Number(line.unit_price)) }
    }

    const { data, error } = await supabase
      .from('restoration_estimate_lines')
      .update(update)
      .eq('id', lineId)
      .select('id, quantity, units, days, unit_price, line_total')
      .single()

    if (error) throw error
    return NextResponse.json({ line: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update line'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ lineId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { lineId } = await params
    const supabase = createAdminClient()

    const { data: line } = await supabase
      .from('restoration_estimate_lines')
      .select('id, project_id')
      .eq('id', lineId)
      .maybeSingle()
    if (!line) return NextResponse.json({ ok: true })
    if (await frozen(supabase, line.project_id)) {
      return NextResponse.json({ error: 'estimate_already_signed' }, { status: 409 })
    }

    const { error } = await supabase
      .from('restoration_estimate_lines')
      .delete()
      .eq('id', lineId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove line'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
