import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()

    const { data: existing, error: existingError } = await supabase
      .from('ops_customers')
      .select('id')
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (body.customer && typeof body.customer === 'object') {
      const c = body.customer
      const updates: Record<string, unknown> = {}

      if (c.first_name !== undefined) updates.first_name = c.first_name
      if (c.last_name !== undefined) updates.last_name = c.last_name
      if (c.full_name !== undefined) {
        updates.full_name = c.full_name
      } else if (c.first_name !== undefined || c.last_name !== undefined) {
        updates.full_name =
          [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Customer'
      }
      if (c.business_name !== undefined) updates.business_name = c.business_name
      if (c.email !== undefined) updates.email = c.email || null
      if (c.phone !== undefined) updates.phone = c.phone
      if (c.notes !== undefined) updates.notes = c.notes || null
      if (c.email_opt_out !== undefined)
        updates.email_opt_out = Boolean(c.email_opt_out)

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString()
        const { error: customerError } = await supabase
          .from('ops_customers')
          .update(updates)
          .eq('id', id)
        if (customerError) throw customerError
      }
    }

    if (Array.isArray(body.addresses)) {
      for (const addr of body.addresses) {
        if (!addr.id) continue

        const { data: addrRow } = await supabase
          .from('ops_service_addresses')
          .select('id')
          .eq('id', addr.id)
          .eq('customer_id', id)
          .single()

        if (!addrRow) continue

        const updates: Record<string, unknown> = {}
        if (addr.street_1 !== undefined) updates.street_1 = addr.street_1
        if (addr.street_2 !== undefined)
          updates.street_2 = addr.street_2 || null
        if (addr.city !== undefined) updates.city = addr.city
        if (addr.state !== undefined) updates.state = addr.state
        if (addr.zip_code !== undefined) updates.zip_code = addr.zip_code
        if (addr.gate_code !== undefined)
          updates.gate_code = addr.gate_code || null
        if (addr.notes !== undefined) updates.notes = addr.notes || null
        if (addr.label !== undefined) updates.label = addr.label || null

        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString()
          const { error: addrError } = await supabase
            .from('ops_service_addresses')
            .update(updates)
            .eq('id', addr.id)
          if (addrError) throw addrError
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[ops/customers/:id][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update customer' },
      { status: 500 },
    )
  }
}
