import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { validateAgentRequest, checkRateLimit } from '@/lib/agent-auth'
import {
  applyAppointmentBuffer,
  getAvailableSlots,
} from '@/lib/ops/availability'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const DEFAULT_DURATION_MINUTES = 120

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export async function GET(request: NextRequest) {
  try {
    const auth = await validateAgentRequest(request)
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: CORS },
      )
    }

    const rl = checkRateLimit(auth.key.id, '/api/agent/availability')
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please slow down.' },
        {
          status: 429,
          headers: {
            ...CORS,
            'Retry-After': String(Math.ceil((rl.retryAfterMs || 60000) / 1000)),
          },
        },
      )
    }

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const durationParam = Number(searchParams.get('duration_minutes') || '0')

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'date query parameter is required (YYYY-MM-DD format)' },
        { status: 400, headers: CORS },
      )
    }

    const today = new Date().toISOString().split('T')[0]
    if (date < today) {
      return NextResponse.json(
        { date, slots: [], message: 'Cannot book in the past' },
        { headers: CORS },
      )
    }

    const requiredMinutes = applyAppointmentBuffer(
      durationParam > 0 ? durationParam : DEFAULT_DURATION_MINUTES,
    )

    const supabase = createAdminClient()

    async function getSlotsForDate(targetDate: string) {
      const [templatesResult, overridesResult, appointmentsResult] =
        await Promise.all([
          supabase
            .from('availability_templates')
            .select('*')
            .eq('is_active', true),
          supabase
            .from('availability_overrides')
            .select('*')
            .eq('override_date', targetDate),
          supabase
            .from('ops_appointments')
            .select('appointment_date, start_time, end_time, status')
            .eq('appointment_date', targetDate),
        ])

      return getAvailableSlots({
        date: targetDate,
        requiredMinutes,
        templates: templatesResult.data || [],
        overrides: overridesResult.data || [],
        appointments: appointmentsResult.data || [],
        maxResults: 8,
      })
    }

    const slots = await getSlotsForDate(date)
    const formatted = slots.map((slot) => ({
      start_time: slot.start_time,
      end_time: slot.end_time,
      label: formatTime(slot.start_time),
    }))

    let nextAvailableDate: string | null = null
    if (formatted.length === 0) {
      const checkDate = new Date(`${date}T12:00:00`)
      for (let i = 1; i <= 14; i++) {
        checkDate.setDate(checkDate.getDate() + 1)
        const candidate = checkDate.toISOString().split('T')[0]
        const candidateSlots = await getSlotsForDate(candidate)
        if (candidateSlots.length > 0) {
          nextAvailableDate = candidate
          break
        }
      }
    }

    return NextResponse.json(
      {
        date,
        slots: formatted,
        ...(formatted.length === 0
          ? {
              message: 'No availability on this date.',
              next_available_date: nextAvailableDate,
            }
          : {}),
      },
      { headers: CORS },
    )
  } catch (err) {
    console.error('[agent/availability] Error:', err)
    return NextResponse.json(
      { error: 'Failed to check availability' },
      { status: 500, headers: CORS },
    )
  }
}
