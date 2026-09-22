import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import { createAiStyleEstimate } from '@/lib/ops/create-ai-style-estimate'
import { createAdminClient } from '@/supabase/server'

const commercialEstimateSchema = z.object({
  customer_id: z.uuid().nullable().optional(),
  service_address_id: z.uuid().nullable().optional(),
  customer: z.object({
    business_name: z.string().trim().min(1).max(300),
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    email: z.email(),
    phone: z.string().trim().min(7).max(40),
  }),
  address: z.object({
    street_1: z.string().trim().max(300),
    street_2: z.string().trim().max(300).optional().default(''),
    city: z.string().trim().max(150),
    state: z.string().trim().max(2).default('CO'),
    zip_code: z.string().trim().max(20),
  }),
  appointment_date: z.iso.date(),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  assigned_staff_user_id: z.uuid(),
  job_description: z.string().trim().min(1).max(5000),
  lead_source: z.string().trim().min(1).max(200),
  lead_source_detail: z.string().trim().max(500).nullable().optional(),
})
const ESTIMATE_SELECT = `
  id,
  appointment_date,
  start_time,
  end_time,
  status,
  estimate_status,
  converted_appointment_id,
  quoted_total,
  internal_notes,
  kind,
  created_at,
  updated_at,
  ops_customers!ops_appointments_customer_id_fkey (
    id,
    full_name,
    first_name,
    last_name,
    business_name,
    email,
    phone
  ),
  ops_service_addresses (
    id,
    label,
    street_1,
    street_2,
    city,
    state,
    zip_code,
    gate_code,
    notes
  )
`

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const customerId = searchParams.get('customer_id')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    let query = supabase
      .from('ops_appointments')
      .select(ESTIMATE_SELECT)
      .eq('kind', 'estimate')
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: false })

    if (status) {
      query = query.eq('estimate_status', status)
    }
    if (customerId) {
      query = query.eq('customer_id', customerId)
    }
    if (dateFrom) {
      query = query.gte('appointment_date', dateFrom)
    }
    if (dateTo) {
      query = query.lte('appointment_date', dateTo)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ estimates: data || [] })
  } catch (error) {
    console.error('[ops/estimates][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load estimates' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const body = commercialEstimateSchema.parse(await request.json())
    const result = await createAiStyleEstimate({
      supabase: createAdminClient(),
      customer_id: body.customer_id,
      service_address_id: body.service_address_id,
      customer: body.customer,
      address: body.address,
      appointment_date: body.appointment_date,
      start_time: body.start_time,
      visit_duration_minutes: 60,
      assigned_staff_user_id: body.assigned_staff_user_id,
      job_description: body.job_description,
      booking_channel: 'admin',
      source_label: 'Admin Commercial Estimate',
      lead_source: body.lead_source,
      lead_source_detail: body.lead_source_detail,
      actor_label: access.email || access.role,
      admin_heading: 'commercial estimate scheduled',
      created_by: access.id,
    })

    if (!result.ok) {
      return NextResponse.json(result, { status: 409 })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('[ops/estimates][POST] Error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message || 'Check the estimate details.'
            : error instanceof Error && error.message === 'Not authorized'
              ? 'Not authorized'
              : 'Unable to schedule commercial estimate',
      },
      {
        status:
          error instanceof z.ZodError
            ? 400
            : error instanceof Error && error.message === 'Not authorized'
              ? 403
              : 500,
      },
    )
  }
}
