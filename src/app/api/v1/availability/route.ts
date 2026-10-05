import { NextRequest, NextResponse } from 'next/server'
import { handleApiV1Get, methodNotAllowed } from '@/lib/api-v1/http'
import {
  API_TIME_ZONE,
  paginationPayload,
  parsePagination,
  requireDate,
} from '@/lib/api-v1/query'
import { applyAppointmentBuffer } from '@/lib/ops/availability'
import { getAllStaffSlots } from '@/lib/ops/staff-availability'

const DEFAULT_DURATION_MINUTES = 120

export async function GET(request: NextRequest) {
  return handleApiV1Get(request, async ({ supabase }) => {
    const searchParams = request.nextUrl.searchParams
    const date = requireDate(searchParams.get('date'))
    const pagination = parsePagination(searchParams)
    const durationMinutes = applyAppointmentBuffer(DEFAULT_DURATION_MINUTES)
    const staffSlots = await getAllStaffSlots({
      supabase,
      date,
      requiredMinutes: durationMinutes,
      maxResults: 100,
    })

    const slotsByWindow = new Map<
      string,
      {
        start_time: string
        end_time: string
        technicians: Array<{ id: string; name: string }>
      }
    >()

    for (const staff of staffSlots) {
      for (const slot of staff.slots) {
        const key = `${slot.start_time}-${slot.end_time}`
        const existing = slotsByWindow.get(key) || {
          start_time: slot.start_time,
          end_time: slot.end_time,
          technicians: [],
        }
        existing.technicians.push({
          id: staff.staffUserId,
          name: staff.staffName,
        })
        slotsByWindow.set(key, existing)
      }
    }

    const allSlots = [...slotsByWindow.values()].sort((a, b) =>
      a.start_time.localeCompare(b.start_time),
    )
    const data = allSlots.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    )

    return NextResponse.json({
      date,
      timezone: API_TIME_ZONE,
      duration_minutes: durationMinutes,
      data,
      pagination: paginationPayload(pagination, allSlots.length),
    })
  })
}

export const POST = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const HEAD = methodNotAllowed
export const OPTIONS = methodNotAllowed
