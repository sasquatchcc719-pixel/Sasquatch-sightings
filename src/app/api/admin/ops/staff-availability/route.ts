import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const body = await request.json()
    const staffUserId = String(body.staff_user_id || '').trim()
    const date = String(body.date || '').trim()
    const isOpen = Boolean(body.is_open)

    if (!staffUserId || !date) {
      return NextResponse.json(
        { error: 'staff_user_id and date are required' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('staff_daily_availability')
      .upsert(
        { staff_user_id: staffUserId, date, is_open: isOpen },
        { onConflict: 'staff_user_id,date' },
      )
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ ok: true, record: data })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[staff-availability][PUT] Error:', detail)
    return NextResponse.json(
      { error: 'Failed to update staff availability', detail },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const searchParams = request.nextUrl.searchParams
    const staffUserId = String(searchParams.get('staff_user_id') || '').trim()
    const date = String(searchParams.get('date') || '').trim()

    if (!staffUserId || !date) {
      return NextResponse.json(
        { error: 'staff_user_id and date are required' },
        { status: 400 },
      )
    }

    const { error } = await supabase
      .from('staff_daily_availability')
      .delete()
      .eq('staff_user_id', staffUserId)
      .eq('date', date)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[staff-availability][DELETE] Error:', detail)
    return NextResponse.json(
      { error: 'Failed to delete staff availability override', detail },
      { status: 500 },
    )
  }
}
