import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

function isMissingTableError(message: string | undefined): boolean {
  const normalized = (message || '').toLowerCase()
  return (
    normalized.includes('does not exist') ||
    normalized.includes('relation') ||
    normalized.includes('schema cache')
  )
}

export async function GET() {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
      'marketing',
    ])
    const supabase = createAdminClient()

    const { data: services, error: servicesError } = await supabase
      .from('service_catalog_items')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name')

    if (servicesError) {
      if (isMissingTableError(servicesError.message)) {
        return NextResponse.json({
          role: access.role,
          migrationReady: false,
          services: [],
          availabilityTemplates: [],
          availabilityOverrides: [],
          appointments: [],
          quickbooksJobs: [],
        })
      }

      throw servicesError
    }

    const today = new Date()
    const startDate = today.toISOString().slice(0, 10)
    const endDate = new Date(today.getTime() + 1000 * 60 * 60 * 24 * 14)
      .toISOString()
      .slice(0, 10)

    const [
      availabilityTemplatesResult,
      availabilityOverridesResult,
      appointmentsResult,
      quickbooksJobsResult,
    ] = await Promise.all([
      supabase
        .from('availability_templates')
        .select('*')
        .order('day_of_week')
        .order('start_time'),
      supabase
        .from('availability_overrides')
        .select('*')
        .gte('override_date', startDate)
        .order('override_date')
        .order('start_time'),
      supabase
        .from('ops_appointments')
        .select(
          `
            *,
            ops_customers (
              id,
              full_name,
              email,
              phone
            ),
            ops_service_addresses (
              id,
              street_1,
              street_2,
              city,
              state,
              zip_code
            ),
            ops_appointment_line_items (
              id,
              name_snapshot,
              quantity,
              unit_price,
              duration_minutes,
              buffer_minutes,
              line_total
            ),
            ops_invoices (
              id,
              status,
              payment_status,
              sync_status,
              subtotal,
              total,
              quickbooks_invoice_id
            )
          `,
        )
        .gte('appointment_date', startDate)
        .lte('appointment_date', endDate)
        .order('appointment_date')
        .order('start_time'),
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    if (availabilityTemplatesResult.error)
      throw availabilityTemplatesResult.error
    if (availabilityOverridesResult.error)
      throw availabilityOverridesResult.error
    if (appointmentsResult.error) throw appointmentsResult.error
    if (quickbooksJobsResult.error) throw quickbooksJobsResult.error

    return NextResponse.json({
      role: access.role,
      migrationReady: true,
      services: services || [],
      availabilityTemplates: availabilityTemplatesResult.data || [],
      availabilityOverrides: availabilityOverridesResult.data || [],
      appointments: appointmentsResult.data || [],
      quickbooksJobs: quickbooksJobsResult.data || [],
    })
  } catch (error) {
    console.error('[ops/bootstrap] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load operations dashboard data' },
      { status: 500 },
    )
  }
}
