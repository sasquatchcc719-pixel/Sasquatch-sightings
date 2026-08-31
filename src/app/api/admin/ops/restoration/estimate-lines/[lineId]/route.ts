import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Adjust a quantity. The price comes from the catalog, never the client. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ lineId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { lineId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const quantity = Number(body.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: 'quantity must be greater than zero' }, { status: 400 })
    }

    const { data: line } = await supabase
      .from('restoration_estimate_lines')
      .select('id, unit_price')
      .eq('id', lineId)
      .maybeSingle()
    if (!line) return NextResponse.json({ error: 'line_not_found' }, { status: 404 })

    const { data, error } = await supabase
      .from('restoration_estimate_lines')
      .update({ quantity, line_total: round2(quantity * Number(line.unit_price)) })
      .eq('id', lineId)
      .select('id, quantity, unit_price, line_total')
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
