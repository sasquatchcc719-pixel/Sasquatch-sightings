import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
    const supabase = createAdminClient()

    const searchParams = request.nextUrl.searchParams
    const startDate = String(searchParams.get('start_date') || '').trim()
    const endDate = String(searchParams.get('end_date') || '').trim()

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'start_date and end_date are required' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('ops_calendar_events')
      .select('*')
      .lte('start_date', endDate)
      .gte('end_date', startDate)
      .order('start_date')
      .order('start_time')

    if (error) throw error

    return NextResponse.json({ events: data || [] })
  } catch (error) {
    console.error('[ops/events][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load calendar events' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const body = await request.json()

    const title = String(body.title || '').trim()
    const startDate = String(body.start_date || '').trim()
    const endDate = String(body.end_date || '').trim()
    const startTime = body.start_time ? String(body.start_time).trim() : null
    const endTime = body.end_time ? String(body.end_time).trim() : null
    const description = body.description
      ? String(body.description).trim()
      : null
    const isAllDay = Boolean(body.is_all_day)

    if (!title || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'title, start_date, and end_date are required' },
        { status: 400 },
      )
    }

    if ((startTime && !endTime) || (!startTime && endTime)) {
      return NextResponse.json(
        { error: 'Provide both start_time and end_time or leave both blank' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('ops_calendar_events')
      .insert({
        title,
        description,
        start_date: startDate,
        end_date: endDate,
        start_time: startTime || null,
        end_time: endTime || null,
        is_all_day: isAllDay || !startTime || !endTime,
        assigned_staff_user_id: body.assigned_staff_user_id || null,
        created_by: access.id,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ event: data }, { status: 201 })
  } catch (error) {
    console.error('[ops/events][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create calendar event' },
      { status: 500 },
    )
  }
}
