import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('staff_users')
      .select('id, user_id, display_name, role, profile_image_url, hourly_rate')
      .eq('is_active', true)
      .order('scheduling_priority', { ascending: true })

    if (error) throw error

    return NextResponse.json({ staff: data || [] })
  } catch (error) {
    console.error('[admin/ops/staff][GET]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to load staff' }, { status })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const staffId = String(body.staffId || '').trim()

    if (!staffId) {
      return NextResponse.json({ error: 'staffId is required' }, { status: 400 })
    }

    // An empty string clears the rate (unpaid, e.g. the owner); a number sets it.
    // Only NEW timesheet entries pick this up — past entries keep what they were
    // recorded at, so editing a rate never rewrites history.
    const raw = body.hourlyRate
    let hourlyRate: number | null = null
    if (raw !== '' && raw !== null && raw !== undefined) {
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 500) {
        return NextResponse.json(
          { error: 'Hourly rate must be between 0 and 500' },
          { status: 400 },
        )
      }
      hourlyRate = Math.round(parsed * 100) / 100
    }

    const { data, error } = await supabase
      .from('staff_users')
      .update({ hourly_rate: hourlyRate, updated_at: new Date().toISOString() })
      .eq('id', staffId)
      .select('id, user_id, display_name, role, profile_image_url, hourly_rate')
      .single()

    if (error) throw error

    return NextResponse.json({ staff: data })
  } catch (error) {
    console.error('[admin/ops/staff][PATCH]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to update staff' }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const displayName = String(body.displayName || '').trim()
    const role = String(body.role || 'tech')

    if (!displayName) {
      return NextResponse.json(
        { error: 'Display name is required' },
        { status: 400 },
      )
    }

    if (!['owner', 'dispatcher', 'tech', 'marketing'].includes(role)) {
      return NextResponse.json({ error: 'Invalid staff role' }, { status: 400 })
    }

    const { data: latest } = await supabase
      .from('staff_users')
      .select('scheduling_priority')
      .order('scheduling_priority', { ascending: false })
      .limit(1)
      .maybeSingle()

    const schedulingPriority = Number(latest?.scheduling_priority ?? 0) + 1

    const { data, error } = await supabase
      .from('staff_users')
      .insert({
        user_id: null,
        display_name: displayName,
        role,
        is_active: true,
        default_open: false,
        scheduling_priority: schedulingPriority,
      })
      .select('id, user_id, display_name, role, profile_image_url')
      .single()

    if (error) throw error

    return NextResponse.json({ staff: data }, { status: 201 })
  } catch (error) {
    console.error('[admin/ops/staff][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json({ error: 'Failed to create staff' }, { status })
  }
}
