import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { applyAppointmentBuffer, timeToMinutes } from '@/lib/ops/availability'
import { getSlotsForStaff, getUnionedSlots } from '@/lib/ops/staff-availability'

const DEFAULT_DURATION_MINUTES = 120
const MINIMUM_SAME_DAY_LEAD_MINUTES = 60
const MAX_DAYS = 45

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = []
  const cursor = new Date(`${start}T12:00:00`)
  const last = new Date(`${end}T12:00:00`)
  while (cursor <= last && out.length < MAX_DAYS) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    const d = String(cursor.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${d}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const staffUserId = searchParams.get('staff_user_id')
    const requiredMinutesParam = Number(
      searchParams.get('required_minutes') || '0',
    )

    if (
      !startDate ||
      !endDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
      startDate > endDate
    ) {
      return NextResponse.json(
        { error: 'start_date and end_date are required (YYYY-MM-DD)' },
        { status: 400 },
      )
    }

    const requiredMinutes = applyAppointmentBuffer(
      requiredMinutesParam > 0
        ? requiredMinutesParam
        : DEFAULT_DURATION_MINUTES,
    )

    const now = new Date()
    const todayMT = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    const currentTimeMT = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Denver',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)

    const days = await Promise.all(
      enumerateDates(startDate, endDate).map(async (date) => {
        if (date < todayMT) {
          return { date, slots: 0, is_available: false }
        }
        const minStartMinutes =
          date === todayMT
            ? timeToMinutes(currentTimeMT) + MINIMUM_SAME_DAY_LEAD_MINUTES
            : undefined
        const slots = staffUserId
          ? await getSlotsForStaff({
              supabase,
              date,
              staffUserId,
              requiredMinutes,
              minStartMinutes,
              maxResults: 12,
            })
          : await getUnionedSlots({
              supabase,
              date,
              requiredMinutes,
              minStartMinutes,
              maxResults: 12,
            })
        return { date, slots: slots.length, is_available: slots.length > 0 }
      }),
    )

    return NextResponse.json({ days, start_date: startDate, end_date: endDate })
  } catch (error) {
    console.error('[admin/ops/month-availability] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load month availability' },
      { status: 500 },
    )
  }
}
