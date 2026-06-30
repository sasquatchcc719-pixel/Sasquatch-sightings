import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * GET /api/admin/ops/client-requests
 * Client-portal change requests for the admin review panel (pending first).
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('ops_client_change_requests')
      .select(
        `*,
         ops_customers ( business_name, full_name ),
         ops_appointments ( appointment_date, start_time )`,
      )
      .order('status', { ascending: true }) // 'approved','declined','done','pending' -> we re-sort below
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    // Surface pending first regardless of alpha order.
    const sorted = (data || []).sort((a, b) => {
      const ap = a.status === 'pending' ? 0 : 1
      const bp = b.status === 'pending' ? 0 : 1
      if (ap !== bp) return ap - bp
      return (b.created_at as string).localeCompare(a.created_at as string)
    })

    return NextResponse.json({ requests: sorted })
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load client requests' },
      { status },
    )
  }
}
