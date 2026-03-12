import { NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import {
  isAnalystFeatureEnabled,
  isAnalystHistoryReadonlyEnabled,
} from '@/lib/harry/features'

// GET - Fetch conversation history
export async function GET() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAnalystFeatureEnabled() && !isAnalystHistoryReadonlyEnabled()) {
      return NextResponse.json(
        { error: 'Analyst history is currently disabled' },
        { status: 403 },
      )
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('harry_conversations')
      .select('role, content, created_at')
      .order('created_at', { ascending: true })
      .limit(50)

    if (error) {
      // Table might not exist yet
      return NextResponse.json({ messages: [] })
    }

    return NextResponse.json({ messages: data || [] })
  } catch (error) {
    console.error('History fetch error:', error)
    return NextResponse.json({ messages: [] })
  }
}

// DELETE - Clear conversation history
export async function DELETE() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isAnalystFeatureEnabled()) {
      return NextResponse.json(
        { error: 'Analyst is currently disabled' },
        { status: 403 },
      )
    }

    const supabase = await createClient()

    await supabase
      .from('harry_conversations')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('History clear error:', error)
    return NextResponse.json(
      { error: 'Failed to clear history' },
      { status: 500 },
    )
  }
}
