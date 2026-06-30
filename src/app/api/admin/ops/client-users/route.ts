import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * GET /api/admin/ops/client-users
 * Lists client-portal users (client_manager) for the settings pass-through card.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('ops_client_users')
      .select(
        `id, user_id, display_name, email, is_active,
         ops_customers ( business_name, full_name )`,
      )
      .eq('is_active', true)
      .order('display_name')

    if (error) throw error

    const clients = (data || []).map((c) => {
      const rel = c.ops_customers as
        | { business_name: string | null; full_name: string | null }
        | { business_name: string | null; full_name: string | null }[]
        | null
      const cust = Array.isArray(rel) ? (rel[0] ?? null) : rel
      return {
        id: c.id,
        user_id: c.user_id,
        display_name: c.display_name,
        email: c.email,
        customer_label: cust?.business_name || cust?.full_name || '',
      }
    })

    return NextResponse.json({ clients })
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: 'Failed to load client users' },
      { status },
    )
  }
}
