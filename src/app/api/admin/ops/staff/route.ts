import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('staff_users')
      .select('id, display_name, role, profile_image_url')
      .eq('is_active', true)
      .order('scheduling_priority', { ascending: true })

    if (error) throw error

    return NextResponse.json({ staff: data || [] })
  } catch (error) {
    console.error('[admin/ops/staff][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to load staff' }, { status })
  }
}
