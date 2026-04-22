/**
 * Update/Delete Conversation
 * Allows admins to mark conversations as completed, reopen them, or delete them.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '../../../../supabase/server'
import { getUserWithRole } from '@/lib/auth'

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

    // mark_read action: sets admin_read_at = now()
    if (body.action === 'mark_read') {
      const supabase = createAdminClient()
      const { error } = await supabase
        .from('conversations')
        .update({ admin_read_at: new Date().toISOString() })
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
