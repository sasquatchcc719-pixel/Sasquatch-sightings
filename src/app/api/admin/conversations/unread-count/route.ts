/**
 * Conversations Unread Count API
 * GET  – returns total unread + per-channel breakdown
 * PATCH – bulk marks all conversations as read
 *
 * "Unread" = per inbound (role `user`) message with timestamp > admin_read_at
 * (same as Comms hub and conversation list). `total` is the sum of those
 * message counts, not a thread count.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import {
  countUnreadInboundMessages,
  sourceToCommsChannel,
} from '@/lib/conversations-unread'

type ConversationRow = {
  id: string
  source: string | null
  messages: { role: string; timestamp?: string }[]
  admin_read_at: string | null
  updated_at: string
}

export async function GET() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !role || !['admin', 'owner', 'dispatcher'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    const { data: conversations, error } = await supabase
      .from('conversations')
      .select('id, source, messages, admin_read_at, updated_at')
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('[unread-count] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch conversations' },
        { status: 500 },
      )
    }

    const rows = (conversations || []) as ConversationRow[]

    const byChannel = { phone: 0, lsa: 0, yelp: 0, other: 0 }
    let total = 0

    for (const conv of rows) {
      const n = countUnreadInboundMessages(conv)
      if (n > 0) {
        total += n
        byChannel[sourceToCommsChannel(conv.source)] += n
      }
    }

    return NextResponse.json({ total, byChannel })
  } catch (err) {
    console.error('[unread-count] error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function PATCH() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !role || !['admin', 'owner', 'dispatcher'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    const now = new Date().toISOString()

    // Mark all conversations read — simpler and safe since we're doing bulk mark-all
    const { error } = await supabase
      .from('conversations')
      .update({ admin_read_at: now })
      .neq('id', '00000000-0000-0000-0000-000000000000') // match all rows

    if (error) {
      console.error('[unread-count] mark-read error:', error)
      return NextResponse.json(
        { error: 'Failed to mark read' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[unread-count] patch error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
