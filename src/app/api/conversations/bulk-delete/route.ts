import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id: unknown) => typeof id === 'string' && id.trim())
      : []

    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'At least one conversation id is required' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('conversations')
      .delete()
      .in('id', ids)
    if (error) {
      console.error('Bulk delete conversations error:', error)
      return NextResponse.json(
        { error: 'Failed to delete conversations' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, deleted_count: ids.length })
  } catch (error) {
    console.error('Bulk delete conversations error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
