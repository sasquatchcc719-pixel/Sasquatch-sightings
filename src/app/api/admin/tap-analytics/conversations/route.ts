import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('conversations')
      .select('*, lead:leads(id, name, source, status)')
      .eq('source', 'Business Card')
      .order('updated_at', { ascending: false })
      .limit(100)

    if (error) throw error

    return NextResponse.json({ conversations: data || [] })
  } catch (error) {
    console.error('[tap-analytics/conversations] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load business card conversations' },
      { status: 500 },
    )
  }
}
