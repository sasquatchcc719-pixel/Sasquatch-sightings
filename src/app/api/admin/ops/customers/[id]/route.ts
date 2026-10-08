import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { normalizePhone } from '@/lib/blacklist'
import { createAdminClient } from '@/supabase/server'
import {
  invalidateGeocodeForAddressUpdate,
  queueGeocodeForStoredAddress,
} from '@/lib/ops/forward-geocode'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()

    const { data: existing, error: existingError } = await supabase
      .from('ops_customers')
      .select('id, billing_mode, phone, full_name, business_name')
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (body.customer && typeof body.customer === 'object') {
      const c = body.customer
      const updates: Record<string, unknown> = {}
      let blacklistUpdate:
        | { id: string; phone: string; name: string }
        | undefined

      if (c.first_name !== undefined) updates.first_name = c.first_name
      if (c.last_name !== undefined) updates.last_name = c.last_name
      if (c.full_name !== undefined) {
        updates.full_name = c.full_name
      } else if (c.first_name !== undefined || c.last_name !== undefined) {
        updates.full_name =
          [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Customer'
      }
      if (c.business_name !== undefined) updates.business_name = c.business_name
      if (c.is_commercial !== undefined)
        updates.is_commercial = Boolean(c.is_commercial)
      else if (
        c.business_name !== undefined &&
        String(c.business_name || '').trim()
      ) {
        updates.is_commercial = true
      }
      if (c.email !== undefined) updates.email = c.email || null
      if (c.phone !== undefined) updates.phone = c.phone
      if (c.notes !== undefined) updates.notes = c.notes || null
      if (c.email_opt_out !== undefined)
        updates.email_opt_out = Boolean(c.email_opt_out)

      const blacklistProfileChanged =
        c.phone !== undefined ||
        c.full_name !== undefined ||
        c.first_name !== undefined ||
        c.last_name !== undefined ||
        c.business_name !== undefined
      if (blacklistProfileChanged) {
        const oldPhone = normalizePhone(String(existing.phone || ''))
        const { data: blacklistEntry, error: blacklistLookupError } =
          oldPhone.length === 10
            ? await supabase
                .from('blacklist')
                .select('id')
                .eq('phone', oldPhone)
                .maybeSingle()
            : { data: null, error: null }

        if (blacklistLookupError) throw blacklistLookupError

        if (blacklistEntry) {
          const nextPhone = normalizePhone(
            String(c.phone !== undefined ? c.phone : existing.phone || ''),
          )
          if (nextPhone.length !== 10) {
            return NextResponse.json(
              {
                error:
                  'A blacklisted customer must keep a valid 10-digit phone number.',
              },
              { status: 400 },
            )
          }

          if (nextPhone !== oldPhone) {
            const { data: conflict, error: conflictError } = await supabase
              .from('blacklist')
              .select('id')
              .eq('phone', nextPhone)
              .maybeSingle()
            if (conflictError) throw conflictError
            if (conflict && conflict.id !== blacklistEntry.id) {
              return NextResponse.json(
                { error: 'The new phone number is already blacklisted.' },
                { status: 409 },
              )
            }
          }

          const nextBusinessName =
            c.business_name !== undefined
              ? c.business_name
              : existing.business_name
          blacklistUpdate = {
            id: blacklistEntry.id,
            phone: nextPhone,
            name: String(
              nextBusinessName || updates.full_name || existing.full_name,
            ),
          }
        }
      }

      if (c.billing_mode !== undefined) {
        if (!['immediate', 'monthly_consolidated'].includes(c.billing_mode)) {
          return NextResponse.json(
            { error: 'Invalid billing mode' },
            { status: 400 },
          )
        }
        if (
          c.billing_mode !== existing.billing_mode &&
          !['admin', 'owner'].includes(access.role)
        ) {
          return NextResponse.json(
            { error: 'Only an owner or admin can change billing policy.' },
            { status: 403 },
          )
        }
        if (
          existing.billing_mode === 'monthly_consolidated' &&
          c.billing_mode === 'immediate'
        ) {
          const [{ count: projectCount }, { count: batchCount }] =
            await Promise.all([
              supabase
                .from('restoration_projects')
                .select('id', { count: 'exact', head: true })
                .eq('customer_id', id)
                .in('billing_status', ['ready', 'batched']),
              supabase
                .from('ops_batch_invoices')
                .select('id', { count: 'exact', head: true })
                .eq('customer_id', id)
                .in('status', ['draft', 'ready']),
            ])
          if ((projectCount ?? 0) > 0 || (batchCount ?? 0) > 0) {
            return NextResponse.json(
              {
                error:
                  'Finish or void the customer’s open monthly billing before switching to per-job invoices.',
              },
              { status: 409 },
            )
          }
        }
        updates.billing_mode = c.billing_mode
      }

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString()
        const { error: customerError } = await supabase
          .from('ops_customers')
          .update(updates)
          .eq('id', id)
        if (customerError) throw customerError
      }

      if (blacklistUpdate) {
        const { error: blacklistError } = await supabase
          .from('blacklist')
          .update({
            phone: blacklistUpdate.phone,
            name: blacklistUpdate.name,
          })
          .eq('id', blacklistUpdate.id)
        if (blacklistError) throw blacklistError
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
          const locationChanged = invalidateGeocodeForAddressUpdate(updates)
          updates.updated_at = new Date().toISOString()
          const { error: addrError } = await supabase
            .from('ops_service_addresses')
            .update(updates)
            .eq('id', addr.id)
          if (addrError) throw addrError
          if (locationChanged) {
            await queueGeocodeForStoredAddress(supabase, addr.id)
          }
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
