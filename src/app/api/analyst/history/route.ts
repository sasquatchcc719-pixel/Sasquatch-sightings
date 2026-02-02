import { NextResponse } from 'next/server'
import { createClient } from '@/supabase/server'

// GET - Fetch conversation history
export async function GET() {
  try {
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
