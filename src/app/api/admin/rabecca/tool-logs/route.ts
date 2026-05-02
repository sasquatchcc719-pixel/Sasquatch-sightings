import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 100), 200)
    const functionName = String(searchParams.get('function_name') || '').trim()
    const success = String(searchParams.get('success') || '').trim()

    const supabase = createAdminClient()
    let query = supabase
      .from('retell_tool_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (functionName) query = query.eq('function_name', functionName)
    if (success === 'true') query = query.eq('success', true)
    if (success === 'false') query = query.eq('success', false)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({ logs: data || [], total: count || 0 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[admin/rabecca/tool-logs] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load Rabecca tool logs' },
      { status: 500 },
    )
  }
}
