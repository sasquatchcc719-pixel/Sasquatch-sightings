/**
 * Send SMS Reply from Admin Portal
 * Allows admins to respond to customer SMS directly from the web interface
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { sendConversationReply } from '@/lib/ops/conversation-reply'

export async function POST(request: NextRequest) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !role || !['admin', 'owner', 'dispatcher'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { conversationId, message } = await request.json()

    if (!conversationId || !message) {
      return NextResponse.json(
        { error: 'Missing conversationId or message' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    await sendConversationReply({
      supabase,
      conversationId,
      message,
      sentBy: user.email || role,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Send reply error:', error)
    return NextResponse.json({ error: 'Failed to send reply' }, { status: 500 })
  }
}
