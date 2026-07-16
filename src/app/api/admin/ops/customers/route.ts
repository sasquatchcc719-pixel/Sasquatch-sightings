import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()
    const query = String(request.nextUrl.searchParams.get('q') || '').trim()

    let customerQuery = supabase
      .from('ops_customers')
      .select(
        `
          *,
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
        `,
      )
      .order('updated_at', { ascending: false })
      .limit(10)

    if (query) {
      customerQuery = customerQuery.or(
        [
          `full_name.ilike.%${query}%`,
          `business_name.ilike.%${query}%`,
          `phone.ilike.%${query}%`,
          `email.ilike.%${query}%`,
        ].join(','),
      )
    }

    const { data, error } = await customerQuery

    if (error) throw error

    const customers = data || []

    if (customers.length > 0) {
      const customerIds = customers.map((c: { id: string }) => c.id)

      const { data: statsRows } = await supabase.rpc(
        'get_customer_stats_batch',
        { customer_ids: customerIds },
      )

      if (statsRows && Array.isArray(statsRows)) {
        const statsMap = new Map<string, Record<string, unknown>>()
        for (const row of statsRows) {
          statsMap.set(row.customer_id, row)
        }
        for (const customer of customers as Record<string, unknown>[]) {
          const stats = statsMap.get(customer.id as string)
          customer.job_count = stats?.job_count ?? 0
          customer.last_job_date = stats?.last_job_date ?? null
          customer.total_revenue = stats?.total_revenue ?? 0
          customer.lead_source = stats?.lead_source ?? null
        }
      }

      const { data: jobRows } = await supabase
        .from('ops_appointments')
        .select(
          `id, status, appointment_date, start_time,
           ops_invoices ( id ),
           ops_service_addresses ( street_1, city ),
           ops_job_photos (
             id,
             public_url,
             label,
             source,
             uploaded_by_label,
             original_filename,
             created_at
           ),
           customer_id`,
        )
        .in('customer_id', customerIds)
        .neq('status', 'cancelled')
        .order('appointment_date', { ascending: false })

      if (jobRows && Array.isArray(jobRows)) {
        const jobsMap = new Map<string, Record<string, unknown>[]>()
        for (const row of jobRows) {
          const cid = row.customer_id as string
          if (!jobsMap.has(cid)) jobsMap.set(cid, [])
          jobsMap.get(cid)!.push(row)
        }
        for (const customer of customers as Record<string, unknown>[]) {
          customer.jobs = jobsMap.get(customer.id as string) ?? []
        }
      }

      const { data: mediaRows, error: mediaError } = await supabase
        .from('ops_customer_media')
        .select(
          'id, customer_id, appointment_id, job_photo_id, storage_path, content_type, category, created_at',
        )
        .in('customer_id', customerIds)
        .eq('status', 'available')
        .order('created_at', { ascending: false })

      if (mediaError) throw mediaError
      const signedMedia = await Promise.all(
        (mediaRows || []).map(async (row) => {
          const { data: signed } = await supabase.storage
            .from('customer-media')
            .createSignedUrl(row.storage_path, 60 * 60)
          return {
            id: row.id,
            customer_id: row.customer_id,
            appointment_id: row.appointment_id,
            job_photo_id: row.job_photo_id,
            content_type: row.content_type,
            category: row.category,
            created_at: row.created_at,
            signed_url: signed?.signedUrl || null,
          }
        }),
      )
      const mediaMap = new Map<string, Record<string, unknown>[]>()
      for (const media of signedMedia) {
        if (!media.customer_id || !media.signed_url) continue
        if (!mediaMap.has(media.customer_id))
          mediaMap.set(media.customer_id, [])
        mediaMap.get(media.customer_id)!.push(media)
      }
      for (const customer of customers as Record<string, unknown>[]) {
        customer.customer_media = mediaMap.get(customer.id as string) ?? []
      }
    }

    return NextResponse.json({ customers })
  } catch (error) {
    console.error('[ops/customers][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load customers' },
      { status: 500 },
    )
  }
}
