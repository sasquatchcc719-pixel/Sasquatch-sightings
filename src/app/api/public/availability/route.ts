import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  getAvailableSlots,
} from '@/lib/ops/availability'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Default job duration for public bookings when we can't calculate exactly
const DEFAULT_DURATION_MINUTES = 120

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const requiredMinutesParam = Number(
      searchParams.get('required_minutes') || '0',
    )

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'date is required (YYYY-MM-DD)' },
        { status: 400, headers: CORS },
      )
    }

    // Don't allow booking in the past (use Mountain Time to avoid UTC rollover)
    const todayMT = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Denver',
    })
    if (date < todayMT) {
      return NextResponse.json({ slots: [] }, { headers: CORS })
    }

    const requiredMinutes = applyAppointmentBuffer(
      requiredMinutesParam > 0
        ? requiredMinutesParam
        : DEFAULT_DURATION_MINUTES,
    )

    const supabase = createAdminClient()
    const [templatesResult, overridesResult, appointmentsResult] =
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
      ])

    const slots = getAvailableSlots({
      date,
      requiredMinutes,
      templates: templatesResult.data || [],
      overrides: overridesResult.data || [],
      appointments: appointmentsResult.data || [],
      maxResults: 8,
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
