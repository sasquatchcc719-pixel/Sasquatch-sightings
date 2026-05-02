import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 50), 100)

    const supabase = createAdminClient()
    const { data, error, count } = await supabase
      .from('retell_call_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    return NextResponse.json({ calls: data || [], total: count || 0 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[admin/rabecca/call-logs] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load Rabecca call logs' },
      { status: 500 },
    )
  }
}
