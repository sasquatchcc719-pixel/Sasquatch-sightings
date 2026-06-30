import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/admin/ops/client-requests/[id]
 * Resolve a client request. Body: { status: 'approved'|'declined'|'done'|'pending', admin_notes? }
 * This only records Charles's decision + reply — applying the actual schedule change is done
 * with the normal (conflict-aware) admin tools.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id: userId } = await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const allowed = ['approved', 'declined', 'done', 'pending']
    if (!allowed.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    }
    if (typeof body.admin_notes === 'string') {
      updates.admin_notes = body.admin_notes.slice(0, 2000)
    }
    if (body.status === 'pending') {
      updates.resolved_at = null
      updates.resolved_by_user_id = null
    } else {
      updates.resolved_at = new Date().toISOString()
      updates.resolved_by_user_id = userId
    }

    const { error } = await supabase
      .from('ops_client_change_requests')
      .update(updates)
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to update request' }, { status })
  }
}
