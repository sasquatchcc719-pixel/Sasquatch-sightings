import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { deleteRestorationWorkLine } from '@/lib/ops/restoration-charge-deletion'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Adjust a quantity. Unit price is never taken from the client. */
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
      return NextResponse.json(
        { error: 'quantity must be greater than zero' },
        { status: 400 },
      )
    }

    const { data: line } = await supabase
      .from('ops_appointment_line_items')
      .select('id, unit_price')
      .eq('id', lineId)
      .maybeSingle()
    if (!line)
      return NextResponse.json({ error: 'line_not_found' }, { status: 404 })

    const { data: updated, error } = await supabase
      .from('ops_appointment_line_items')
      .update({
        quantity,
        line_total: round2(quantity * Number(line.unit_price)),
      })
      .eq('id', lineId)
      .select('id, quantity, unit_price, line_total')
      .single()

    if (error) throw error
    return NextResponse.json({ line: updated })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update line'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ lineId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { lineId } = await params
    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const result = await deleteRestorationWorkLine(supabase, {
      projectId,
      lineId,
    })
    if (!result.ok) {
      if (result.error === 'project_financially_locked') {
        return NextResponse.json(
          {
            error:
              'This charge is locked because the restoration job has already been closed or invoiced.',
          },
          { status: 409 },
        )
      }
      if (
        result.error === 'charge_not_found' ||
        result.error === 'project_not_found'
      ) {
        return NextResponse.json({ error: 'charge_not_found' }, { status: 404 })
      }
      throw new Error(result.error)
    }

    console.info('[restoration-charge-delete] work line removed', {
      projectId,
      lineId,
      removedAmount: result.removedAmount,
    })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[restoration-charge-delete] work line failed', {
      error: e instanceof Error ? e.message : String(e),
    })
    const message = e instanceof Error ? e.message : 'Failed to remove line'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
  }
}
