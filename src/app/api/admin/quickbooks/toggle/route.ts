import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { enabled } = await request.json()
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('quickbooks_oauth_tokens')
      .update({ sync_enabled: enabled, updated_at: new Date().toISOString() })
      .not('id', 'is', null)

    if (error) throw error

    return NextResponse.json({ sync_enabled: enabled })
  } catch (error) {
    console.error('[quickbooks/toggle] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
