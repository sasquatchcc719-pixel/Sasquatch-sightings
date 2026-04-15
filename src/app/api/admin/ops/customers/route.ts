import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
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
