/**
 * AI Agent API — GET /api/agent/availability
 * Public endpoint — no auth required.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { applyAppointmentBuffer } from '@/lib/ops/availability'
import { getUnionedSlots } from '@/lib/ops/staff-availability'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

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
      durationParam > 0 ? durationParam : 120,
    )
    const supabase = createAdminClient()

    const slots = await getUnionedSlots({
      supabase,
      date,
      requiredMinutes,
      maxResults: 8,
    })

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
        const candidateSlots = await getUnionedSlots({
          supabase,
          date: candidate,
          requiredMinutes,
          maxResults: 1,
        })
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
