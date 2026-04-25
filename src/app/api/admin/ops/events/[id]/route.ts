import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()

    const title =
      body.title !== undefined ? String(body.title || '').trim() : undefined
    const startDate =
      body.start_date !== undefined
        ? String(body.start_date || '').trim()
        : undefined
    const endDate =
      body.end_date !== undefined
        ? String(body.end_date || '').trim()
        : undefined
    const startTime =
      body.start_time !== undefined
        ? body.start_time
          ? String(body.start_time).trim()
          : null
        : undefined
    const endTime =
      body.end_time !== undefined
        ? body.end_time
          ? String(body.end_time).trim()
          : null
        : undefined
    const description =
      body.description !== undefined
        ? body.description
          ? String(body.description).trim()
          : null
        : undefined
    const isAllDay =
      body.is_all_day !== undefined ? Boolean(body.is_all_day) : undefined

    if (title !== undefined && !title) {
      return NextResponse.json(
        { error: 'Title cannot be empty' },
        { status: 400 },
      )
    }

    const updates: Record<string, unknown> = {}
    if (title !== undefined) updates.title = title
    if (startDate !== undefined) updates.start_date = startDate
    if (endDate !== undefined) updates.end_date = endDate
    if (startTime !== undefined) updates.start_time = startTime
    if (endTime !== undefined) updates.end_time = endTime
    if (description !== undefined) updates.description = description
    if (isAllDay !== undefined) {
      updates.is_all_day = isAllDay
      if (isAllDay) {
        updates.start_time = null
        updates.end_time = null
      }
    }

    const { data, error } = await supabase
      .from('ops_calendar_events')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ event: data })
  } catch (error) {
    console.error('[ops/events/:id][PATCH]', error)
    return NextResponse.json(
      { error: 'Failed to update event' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params

    const { error } = await supabase
      .from('ops_calendar_events')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[ops/events/:id][DELETE]', error)
    return NextResponse.json(
      { error: 'Failed to delete event' },
      { status: 500 },
    )
  }
}
