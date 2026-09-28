import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/** Delete a monitor visit that is still waiting in the unscheduled tray. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('restoration_visit_queue')
      .delete()
      .eq('id', id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json(
        { error: 'Unscheduled visit not found' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, queue_id: data.id })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to delete visit'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
  }
}
