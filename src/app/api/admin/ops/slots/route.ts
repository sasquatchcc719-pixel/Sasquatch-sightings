import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calendarEventsToAppointmentWindows,
  calculateLineItemDurationMinutes,
  getAvailableSlots,
} from '@/lib/ops/availability'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
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

      const requiredMinutes = calculateLineItemDurationMinutes({
        durationMinutes: service.default_duration_minutes,
        quantity,
        pricingUnit: service.pricing_unit ?? null,
        unitPrice: Number(service.base_price || 0),
        catalogSlug: service.slug ?? null,
        nameSnapshot: service.name ?? null,
      })
      requiredMinutesWithBuffer = applyAppointmentBuffer(requiredMinutes)
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

    if (templatesResult.error) throw templatesResult.error
    if (overridesResult.error) throw overridesResult.error
    if (appointmentsResult.error) throw appointmentsResult.error
    if (eventsResult.error) throw eventsResult.error

    const slots = getAvailableSlots({
      date,
      requiredMinutes: requiredMinutesWithBuffer,
      templates: templatesResult.data || [],
      overrides: overridesResult.data || [],
      appointments: [
        ...(appointmentsResult.data || []),
        ...calendarEventsToAppointmentWindows(date, eventsResult.data || []),
      ],
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
