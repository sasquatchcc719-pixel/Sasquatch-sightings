import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// GET - Fetch all voicemails
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('sms_logs')
      .select('*')
      .eq('message_type', 'voicemail_received')
      .order('sent_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[Voicemails] Error fetching:', error)
      return NextResponse.json(
        { error: 'Failed to fetch voicemails' },
        { status: 500 },
      )
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('[Voicemails] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
