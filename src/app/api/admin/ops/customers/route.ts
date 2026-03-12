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

    return NextResponse.json({ customers: data || [] })
  } catch (error) {
    console.error('[ops/customers][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load customers' },
      { status: 500 },
    )
  }
}
