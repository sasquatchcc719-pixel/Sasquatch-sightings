/**
 * Update/Delete Conversation
 * Allows admins to mark conversations as completed, reopen them, or delete them.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '../../../../supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { computeReadWatermarkIso } from '@/lib/conversations-unread'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !role || !['admin', 'owner', 'dispatcher'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id: conversationId } = await params

    // mark_read: set admin_read_at to max(now, latest inbound message time)
    if (body.action === 'mark_read') {
      const supabase = createAdminClient()
      const { data: row, error: fetchErr } = await supabase
        .from('conversations')
        .select('messages')
        .eq('id', conversationId)
        .single()

      if (fetchErr || !row) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 },
        )
      }

      const messages = Array.isArray(row.messages) ? row.messages : []
      const readAt = computeReadWatermarkIso(
        messages as Array<{ role: string; timestamp?: string }>,
      )

      const { error } = await supabase
        .from('conversations')
        .update({ admin_read_at: readAt })
        .eq('id', conversationId)

      if (error) {
        console.error('Mark read error:', error)
        return NextResponse.json(
          { error: 'Failed to mark read' },
          { status: 500 },
        )
      }
      return NextResponse.json({ success: true })
    }

    // set_auto_reply action: toggles Harry's auto-reply for a single conversation.
    // Google LSA conversations must stay automated — turning auto OFF is rejected.
    if (body.action === 'set_auto_reply') {
      const enabled = body.enabled === true
      const supabase = createAdminClient()

      const { data: convo, error: fetchErr } = await supabase
        .from('conversations')
        .select('source')
        .eq('id', conversationId)
        .single()

      if (fetchErr || !convo) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 },
        )
      }

      const isLsa = convo.source === 'Google LSA' || convo.source === 'lsa'
      if (isLsa && !enabled) {
        return NextResponse.json(
          {
            error:
              'Google LSA conversations must remain automated. Harry auto-reply cannot be disabled for LSA leads.',
          },
          { status: 400 },
        )
      }

      const { error } = await supabase
        .from('conversations')
        .update({ ai_enabled: enabled })
        .eq('id', conversationId)

      if (error) {
        console.error('Set auto_reply error:', error)
        return NextResponse.json(
          { error: 'Failed to update auto-reply setting' },
          { status: 500 },
        )
      }
      return NextResponse.json({ success: true, ai_enabled: enabled })
    }

    // Original status update
    const { status } = body

    if (!status || !['active', 'completed', 'escalated'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status or action' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('conversations')
      .update({ status })
      .eq('id', conversationId)

    if (error) {
      console.error('Update status error:', error)
      return NextResponse.json(
        { error: 'Failed to update status' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update conversation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !role || !['admin', 'owner', 'dispatcher'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: conversationId } = await params

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)

    if (error) {
      console.error('Delete conversation error:', error)
      return NextResponse.json(
        { error: 'Failed to delete conversation' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete conversation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
