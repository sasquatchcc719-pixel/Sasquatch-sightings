import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calendarEventsToAppointmentWindows,
  getAvailableSlots,
  timeToMinutes,
} from '@/lib/ops/availability'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Default job duration for public bookings when we can't calculate exactly
const DEFAULT_DURATION_MINUTES = 120
const MINIMUM_SAME_DAY_LEAD_MINUTES = 60

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const requiredMinutesParam = Number(
      searchParams.get('required_minutes') || '0',
    )

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'date is required (YYYY-MM-DD)' },
        { status: 400, headers: CORS },
      )
    }
    if (
      !date &&
      (!startDate ||
        !endDate ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
        startDate > endDate)
    ) {
      return NextResponse.json(
        { error: 'date or start_date/end_date is required (YYYY-MM-DD)' },
        { status: 400, headers: CORS },
      )
    }

    // Don't allow booking in the past (use Mountain Time to avoid UTC rollover)
    const now = new Date()
    const todayMT = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    if (date && date < todayMT) {
      return NextResponse.json({ slots: [] }, { headers: CORS })
    }
    const currentTimeMT = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Denver',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)
    const minStartMinutes =
      date === todayMT
        ? timeToMinutes(currentTimeMT) + MINIMUM_SAME_DAY_LEAD_MINUTES
        : undefined

    const requiredMinutes = applyAppointmentBuffer(
      requiredMinutesParam > 0
        ? requiredMinutesParam
        : DEFAULT_DURATION_MINUTES,
    )

    const supabase = createAdminClient()
    if (startDate && endDate && !date) {
      const cappedDates = enumerateDates(startDate, endDate).slice(0, 45)
      const rangeStart = cappedDates[0]
      const rangeEnd = cappedDates[cappedDates.length - 1]
      const [
        templatesResult,
        overridesResult,
        appointmentsResult,
        eventsResult,
      ] = await Promise.all([
        supabase
          .from('availability_templates')
          .select('*')
          .eq('is_active', true),
        supabase
          .from('availability_overrides')
          .select('*')
          .gte('override_date', rangeStart)
          .lte('override_date', rangeEnd),
        supabase
          .from('ops_appointments')
          .select('appointment_date, start_time, end_time, status')
          .gte('appointment_date', rangeStart)
          .lte('appointment_date', rangeEnd),
        supabase
          .from('ops_calendar_events')
          .select(
            'event_kind, start_date, end_date, start_time, end_time, is_all_day',
          )
          .lte('start_date', rangeEnd)
          .gte('end_date', rangeStart),
      ])

      const days = cappedDates.map((targetDate) => {
        if (targetDate < todayMT) {
          return { date: targetDate, slots: 0, is_available: false }
        }

        const targetMinStartMinutes =
          targetDate === todayMT ? minStartMinutes : undefined
        const slots = getAvailableSlots({
          date: targetDate,
          requiredMinutes,
          templates: templatesResult.data || [],
          overrides: (overridesResult.data || []).filter(
            (override) => override.override_date === targetDate,
          ),
          appointments: [
            ...(appointmentsResult.data || []).filter(
              (appointment) => appointment.appointment_date === targetDate,
            ),
            ...calendarEventsToAppointmentWindows(
              targetDate,
              eventsResult.data || [],
            ),
          ],
          minStartMinutes: targetMinStartMinutes,
          maxResults: 12,
        })

        return {
          date: targetDate,
          slots: slots.length,
          is_available: slots.length > 0,
        }
      })

      return NextResponse.json(
        { days, start_date: rangeStart, end_date: rangeEnd },
        { headers: CORS },
      )
    }

    if (!date) {
      return NextResponse.json(
        { error: 'date is required (YYYY-MM-DD)' },
        { status: 400, headers: CORS },
      )
    }

    const [templatesResult, overridesResult, appointmentsResult, eventsResult] =
      await Promise.all([
        supabase
          .from('availability_templates')
          .select('*')
          .eq('is_active', true),
        supabase
          .from('availability_overrides')
          .select('*')
          .eq('override_date', date),
        supabase
          .from('ops_appointments')
          .select('appointment_date, start_time, end_time, status')
          .eq('appointment_date', date),
        supabase
          .from('ops_calendar_events')
          .select(
            'event_kind, start_date, end_date, start_time, end_time, is_all_day',
          )
          .lte('start_date', date)
          .gte('end_date', date),
      ])

    const slots = getAvailableSlots({
      date,
      requiredMinutes,
      templates: templatesResult.data || [],
      overrides: overridesResult.data || [],
      appointments: [
        ...(appointmentsResult.data || []),
        ...calendarEventsToAppointmentWindows(date, eventsResult.data || []),
      ],
      minStartMinutes,
      maxResults: 12,
    })

    // Format slots with human-readable labels
    const formatted = slots.map((slot) => ({
      start_time: slot.start_time,
      end_time: slot.end_time,
      label: formatTime(slot.start_time),
    }))

    return NextResponse.json({ slots: formatted, date }, { headers: CORS })
  } catch (error) {
    console.error('[public/availability] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load availability' },
      { status: 500, headers: CORS },
    )
  }
}

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${startDate}T12:00:00`)
  const end = new Date(`${endDate}T12:00:00`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}
