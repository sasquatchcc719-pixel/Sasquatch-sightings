import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { normalizePhone } from '@/lib/blacklist'
import { suppressCustomersForBlacklistedPhone } from '@/lib/ops/customer-blacklist'
import { createAdminClient } from '@/supabase/server'

async function loadCustomer(id: string) {
  const supabase = createAdminClient()
  const { data: customer, error } = await supabase
    .from('ops_customers')
    .select('id, full_name, business_name, phone')
    .eq('id', id)
    .single()

  return { supabase, customer, error }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const body = await request.json()
    const { supabase, customer, error: customerError } = await loadCustomer(id)

    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const phone = normalizePhone(String(customer.phone || ''))
    if (phone.length !== 10) {
      return NextResponse.json(
        { error: 'Customer needs a valid 10-digit phone number first' },
        { status: 400 },
      )
    }

    const reason =
      typeof body.reason === 'string' ? body.reason.trim() || null : null
    const name = customer.business_name || customer.full_name || 'Customer'
    const { data: existing, error: existingError } = await supabase
      .from('blacklist')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()

    if (existingError) throw existingError

    const query = existing
      ? supabase
          .from('blacklist')
          .update({ name, reason })
          .eq('id', existing.id)
      : supabase.from('blacklist').insert({ phone, name, reason })
    const { data: entry, error: blacklistError } = await query.select().single()

    if (blacklistError) throw blacklistError

    await suppressCustomersForBlacklistedPhone(supabase, phone)

    return NextResponse.json({ entry })
  } catch (error) {
    console.error('[ops/customers/:id/blacklist][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to blacklist customer' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const { supabase, customer, error: customerError } = await loadCustomer(id)

    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const phone = normalizePhone(String(customer.phone || ''))
    if (phone.length !== 10) {
      return NextResponse.json(
        { error: 'Customer does not have a valid phone number' },
        { status: 400 },
      )
    }

    const { error } = await supabase
      .from('blacklist')
      .delete()
      .eq('phone', phone)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[ops/customers/:id/blacklist][DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to remove customer from blacklist' },
      { status: 500 },
    )
  }
}
