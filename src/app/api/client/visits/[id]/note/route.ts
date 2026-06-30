import { NextRequest, NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/client/visits/[id]/note
 * Set/clear the client-authored note on a single visit. Safe: notes never touch
 * scheduling. Scoped to the caller's customer_id.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { client } = await requireClientManager()
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null

    // Ownership check: the appointment must belong to this client's customer.
    const { data: appt } = await supabase
      .from('ops_appointments')
      .select('id, customer_id')
      .eq('id', id)
      .maybeSingle()

    if (!appt || appt.customer_id !== client.customer_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { error } = await supabase
      .from('ops_appointments')
      .update({ client_note: note, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true, client_note: note })
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not a client manager'
        ? 403
        : 500
    return NextResponse.json({ error: 'Failed to save note' }, { status })
  }
}
