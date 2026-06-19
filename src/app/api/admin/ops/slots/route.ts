import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
} from '@/lib/ops/availability'
import { getSlotsForStaff, getUnionedSlots } from '@/lib/ops/staff-availability'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const staffUserId = searchParams.get('staff_user_id')
    const serviceId = searchParams.get('service_id')
    const requiredMinutesParam = searchParams.get('required_minutes')
    const quantity = Number(searchParams.get('quantity') || '1')
    const requiredMinutesFromQuery = Number(requiredMinutesParam || '0')

    if (!date) {
      return NextResponse.json({ error: 'date is required' }, { status: 400 })
    }

    let requiredMinutesWithBuffer = 0

    if (
      Number.isFinite(requiredMinutesFromQuery) &&
      requiredMinutesFromQuery > 0
    ) {
      requiredMinutesWithBuffer = applyAppointmentBuffer(
        requiredMinutesFromQuery,
      )
    } else {
      if (!serviceId) {
        return NextResponse.json(
          {
            error:
              'service_id is required when required_minutes is not provided',
          },
          { status: 400 },
        )
      }

      const { data: service, error: serviceError } = await supabase
        .from('service_catalog_items')
        .select(
          'default_duration_minutes, buffer_minutes, base_price, pricing_unit, slug, name',
        )
        .eq('id', serviceId)
        .single()

      if (serviceError) throw serviceError

      if (
        !Number.isFinite(service.default_duration_minutes) ||
        Number(service.default_duration_minutes) <= 0
      ) {
        return NextResponse.json(
          {
            error:
              'This service is missing a duration. Set one in Operations first.',
          },
          { status: 400 },
        )
      }

      // Match what a booking for this service mix would actually store:
      // dollar tiers on the line subtotal.
      requiredMinutesWithBuffer = applyAppointmentBuffer(
        calculateAppointmentDurationFromTotal(
          Number(service.base_price || 0) * Math.max(1, quantity),
        ),
      )
    }

    const slots = staffUserId
      ? await getSlotsForStaff({
          supabase,
          date,
          staffUserId,
          requiredMinutes: requiredMinutesWithBuffer,
          maxResults: 8,
        })
      : await getUnionedSlots({
          supabase,
          date,
          requiredMinutes: requiredMinutesWithBuffer,
          maxResults: 8,
        })

    return NextResponse.json({
      slots,
      requiredMinutes: requiredMinutesWithBuffer,
    })
  } catch (error) {
    console.error('[ops/slots] Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate available slots' },
      { status: 500 },
    )
  }
}
