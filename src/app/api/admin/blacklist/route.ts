import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import { normalizePhone } from '@/lib/blacklist'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('blacklist')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ entries: data ?? [] })
  } catch (err) {
    console.error('[admin/blacklist][GET]', err)
    return NextResponse.json(
      { error: 'Failed to load blacklist' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const body = await request.json()
    const phone =
      typeof body.phone === 'string' ? normalizePhone(body.phone) : ''
    if (phone.length !== 10) {
      return NextResponse.json(
        { error: 'Valid 10-digit phone number required' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('blacklist')
      .insert({
        phone,
        name: body.name?.trim() || null,
        reason: body.reason?.trim() || null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'That phone number is already blacklisted' },
          { status: 409 },
        )
      }
      throw error
    }

    const { data: customerRows, error: customerError } = await supabase
      .from('ops_customers')
      .select('id, phone')
      .not('phone', 'is', null)

    if (customerError) throw customerError

    const matchedCustomerIds = (customerRows || [])
      .filter(
        (customer) => normalizePhone(String(customer.phone || '')) === phone,
      )
      .map((customer) => customer.id as string)

    if (matchedCustomerIds.length > 0) {
      const nowIso = new Date().toISOString()
      const [
        optOutResult,
        queueResult,
        dripResult,
        reviewResult,
        reactivationResult,
      ] = await Promise.all([
        supabase
          .from('ops_customers')
          .update({ email_opt_out: true, updated_at: nowIso })
          .in('id', matchedCustomerIds),
        supabase
          .from('ops_communication_queue')
          .update({
            status: 'cancelled',
            error_message: 'Suppressed: customer was blacklisted',
            updated_at: nowIso,
          })
          .in('customer_id', matchedCustomerIds)
          .eq('status', 'pending'),
        supabase
          .from('drip_campaign_enrollments')
          .update({ status: 'cancelled', updated_at: nowIso })
          .in('customer_id', matchedCustomerIds)
          .eq('status', 'active'),
        supabase
          .from('review_requests')
          .update({
            status: 'skipped',
            skip_reason: 'blacklisted',
            updated_at: nowIso,
          })
          .in('customer_id', matchedCustomerIds)
          .eq('status', 'pending'),
        supabase
          .from('reactivation_campaign_enrollments')
          .update({
            status: 'suppressed_blacklisted',
            stop_reason: 'blacklisted_customer',
            updated_at: nowIso,
          })
          .in('customer_id', matchedCustomerIds)
          .in('status', ['active', 'eligible', 'paused_recent_booking']),
      ])

      const cleanupErrors = [
        optOutResult.error,
        queueResult.error,
        dripResult.error,
        reviewResult.error,
        reactivationResult.error,
      ].filter(Boolean)

      if (cleanupErrors.length > 0) {
        throw cleanupErrors[0]
      }
    }

    return NextResponse.json(
      {
        entry: data,
        suppressed_customer_ids: matchedCustomerIds,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[admin/blacklist][POST]', err)
    return NextResponse.json(
      { error: 'Failed to add to blacklist' },
      { status: 500 },
    )
  }
}
