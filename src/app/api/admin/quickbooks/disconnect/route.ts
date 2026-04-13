import { NextResponse } from 'next/server'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function POST() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !hasRoleAccess(role, ['admin', 'owner'])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('quickbooks_oauth_tokens')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (error) throw error

    return NextResponse.json({
      success: true,
      message: 'QuickBooks disconnected',
    })
  } catch (error) {
    console.error('[quickbooks/disconnect] Error:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect QuickBooks' },
      { status: 500 },
    )
  }
}
