import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { z } from 'zod'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const db = createAdminClient()
    const search = request.nextUrl.searchParams.get('q')?.trim() || ''
    let query = db
      .from('ops_customers')
      .select(
        'id,business_name,full_name,email,phone,is_commercial,ops_commercial_agreements(id,status),ops_client_users(id,is_active)',
      )
      .order('business_name')
      .limit(100)
    if (search)
      query = query.ilike('business_name', `%${search.replace(/[%_]/g, '')}%`)
    else query = query.eq('is_commercial', true)
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ customers: data })
  } catch (e) {
    return NextResponse.json(
      { error: 'Unable to load commercial accounts' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 500,
      },
    )
  }
}
export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { customer_id } = z
      .object({ customer_id: z.uuid() })
      .parse(await request.json())
    const { data, error } = await createAdminClient()
      .from('ops_customers')
      .update({ is_commercial: true })
      .eq('id', customer_id)
      .select('id')
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: 'Unable to enable commercial account' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 400,
      },
    )
  }
}
