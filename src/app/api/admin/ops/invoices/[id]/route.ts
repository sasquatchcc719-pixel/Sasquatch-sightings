import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { assertTechInvoiceAccess } from '@/lib/ops/tech-job-access'
import {
  voidQBInvoice,
  resyncInvoiceToQuickBooks,
  syncAppointmentToQuickBooks,
} from '@/lib/quickbooks-api'
import { generateInvoicePDF } from '@/lib/ops/pdf/generate'
import { ensureInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import {
  leadSourceUpdatePayload,
  normalizeLeadSourceForWrite,
} from '@/lib/server/lead-sources'
import { isBlacklisted } from '@/lib/blacklist'

const INVOICE_SELECT = `
  *,
  ops_appointments (
    id,
    appointment_date,
    start_time,
    end_time,
    status,
    payment_status,
    gps_lat,
    gps_lng,
    quoted_total,
    internal_notes,
    lead_source,
    lead_source_key,
    lead_source_detail,
    original_lead_source,
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
    ),
    ops_job_photos (
      id,
      storage_path,
      public_url,
      label,
      watermarked,
      created_at
    )
  ),
  ops_invoice_line_items (
    id,
    appointment_line_item_id,
    description,
    quantity,
    unit_price,
    line_total
  )
`

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'marketing',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id } = await params
    await assertTechInvoiceAccess(supabase, access, id)

    const { data, error } = await supabase
      .from('ops_invoices')
      .select(INVOICE_SELECT)
      .eq('id', id)
      .single()

    if (error) throw error

    return NextResponse.json({ invoice: data })
  } catch (error) {
    console.error('[ops/invoices/:id][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load invoice' },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()
    await assertTechInvoiceAccess(supabase, access, id)

    if (
      access.role === 'tech' &&
      (body.customer !== undefined ||
        body.address !== undefined ||
        body.appointment !== undefined)
    ) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const { data: current, error: currentError } = await supabase
      .from('ops_invoices')
      .select(
        `
          *,
          ops_invoice_line_items (
            id,
            appointment_line_item_id,
            description,
            quantity,
            unit_price,
            line_total
          )
        `,
      )
      .eq('id', id)
      .single()

    if (currentError) throw currentError

    // ── Customer / address inline edits ──────────────────────
    if (body.customer || body.address) {
      const { data: appt } = await supabase
        .from('ops_appointments')
        .select('customer_id, service_address_id')
        .eq('id', current.appointment_id)
        .single()

      if (appt) {
        if (body.customer && typeof body.customer === 'object') {
          const c = body.customer
          const cu: Record<string, unknown> = {}
          if (c.first_name !== undefined) cu.first_name = c.first_name
          if (c.last_name !== undefined) cu.last_name = c.last_name
          if (c.full_name !== undefined) {
            cu.full_name = c.full_name
          } else if (c.first_name !== undefined || c.last_name !== undefined) {
            cu.full_name =
              [c.first_name, c.last_name].filter(Boolean).join(' ') ||
              'Customer'
          }
          if (c.business_name !== undefined) cu.business_name = c.business_name
          if (c.email !== undefined) cu.email = c.email || null
          if (c.phone !== undefined) cu.phone = c.phone
          if (c.notes !== undefined) cu.notes = c.notes || null
          if (Object.keys(cu).length > 0) {
            cu.updated_at = new Date().toISOString()
            await supabase
              .from('ops_customers')
              .update(cu)
              .eq('id', appt.customer_id)
          }
        }

        if (body.address && typeof body.address === 'object') {
          const a = body.address
          const au: Record<string, unknown> = {}
          if (a.street_1 !== undefined) au.street_1 = a.street_1
          if (a.street_2 !== undefined) au.street_2 = a.street_2 || null
          if (a.city !== undefined) au.city = a.city
          if (a.state !== undefined) au.state = a.state
          if (a.zip_code !== undefined) au.zip_code = a.zip_code
          if (a.gate_code !== undefined) au.gate_code = a.gate_code || null
          if (a.notes !== undefined) au.notes = a.notes || null
          if (Object.keys(au).length > 0) {
            au.updated_at = new Date().toISOString()
            await supabase
              .from('ops_service_addresses')
              .update(au)
              .eq('id', appt.service_address_id)
          }
        }

        if (body.appointment && typeof body.appointment === 'object') {
          const apu: Record<string, unknown> = {}
          if (
            body.appointment.lead_source !== undefined ||
            body.appointment.lead_source_key !== undefined
          ) {
            const normalizedLeadSource = await normalizeLeadSourceForWrite({
              supabase,
              sourceKey: body.appointment.lead_source_key,
              legacyValue: body.appointment.lead_source,
              detail: body.appointment.lead_source_detail,
              requireActive: true,
              requirePublic: false,
              allowMissingDetail: true,
            })
            if (!normalizedLeadSource.ok) {
              return NextResponse.json(
                { error: normalizedLeadSource.error },
                { status: 400 },
              )
            }
            Object.assign(
              apu,
              leadSourceUpdatePayload(normalizedLeadSource.source),
            )
          }
          if (body.appointment.internal_notes !== undefined) {
            apu.internal_notes =
              String(body.appointment.internal_notes || '').trim() || null
          }
          if (Object.keys(apu).length > 0) {
            apu.updated_at = new Date().toISOString()
            await supabase
              .from('ops_appointments')
              .update(apu)
              .eq('id', current.appointment_id)
          }
        }
      }
    }

    const existingInvoiceLines = current.ops_invoice_line_items || []
    const existingDbIds = existingInvoiceLines.map((l: { id: string }) => l.id)
    const lineItemsInBody = Object.prototype.hasOwnProperty.call(
      body,
      'line_items',
    )
    const lineItemsPayload = Array.isArray(body.line_items)
      ? body.line_items
      : []
    const dangerousEmpty =
      lineItemsInBody &&
      lineItemsPayload.length === 0 &&
      existingDbIds.length > 0 &&
      body.clear_line_items !== true

    if (!lineItemsInBody || dangerousEmpty) {
      if (dangerousEmpty) {
        console.warn(
          '[ops/invoices/:id][PATCH] Ignored empty line_items to prevent wiping invoice lines',
        )
      }
    } else {
      const lineItems = lineItemsPayload

      const submittedRealIds = lineItems
        .map((i: { id?: string }) => String(i.id || ''))
        .filter((lid: string) => !lid.startsWith('new-') && lid.length > 0)
      const idsToDelete = existingDbIds.filter(
        (dbId: string) => !submittedRealIds.includes(dbId),
      )
      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('ops_invoice_line_items')
          .delete()
          .in('id', idsToDelete)
        if (deleteError) throw deleteError
      }

      for (const item of lineItems) {
        const lineId = String(item.id || '').trim()
        const description = String(item.description || '').trim()
        const unitPrice = Number(item.unit_price || 0)
        const quantity = Number(item.quantity || 1)
        const lineTotal = Number((unitPrice * quantity).toFixed(2))

        const isNew = !lineId || lineId.startsWith('new-')

        if (isNew) {
          const { error: insertError } = await supabase
            .from('ops_invoice_line_items')
            .insert({
              invoice_id: id,
              appointment_line_item_id: null,
              description,
              quantity,
              unit_price: unitPrice,
              line_total: lineTotal,
            })
          if (insertError) throw insertError
        } else {
          const existingLine = existingInvoiceLines.find(
            (line: { id: string; appointment_line_item_id: string | null }) =>
              line.id === lineId,
          )
          if (!existingLine) continue

          const { error: invoiceLineError } = await supabase
            .from('ops_invoice_line_items')
            .update({
              description,
              quantity,
              unit_price: unitPrice,
              line_total: lineTotal,
            })
            .eq('id', lineId)
          if (invoiceLineError) throw invoiceLineError

          if (existingLine.appointment_line_item_id) {
            const { error: appointmentLineError } = await supabase
              .from('ops_appointment_line_items')
              .update({
                name_snapshot: description,
                unit_price: unitPrice,
                line_total: lineTotal,
              })
              .eq('id', existingLine.appointment_line_item_id)
            if (appointmentLineError) throw appointmentLineError
          }
        }
      }
    }

    const { data: refreshedLines, error: refreshedLinesError } = await supabase
      .from('ops_invoice_line_items')
      .select('*')
      .eq('invoice_id', id)

    if (refreshedLinesError) throw refreshedLinesError

    const subtotal = (refreshedLines || []).reduce(
      (sum, item) => sum + Number(item.line_total || 0),
      0,
    )
    const discountAmount =
      body.discount_amount !== undefined
        ? Math.max(0, Number(body.discount_amount || 0))
        : Number(current.discount_amount || 0)
    const percentageDiscountAmount =
      body.percentage_discount_amount !== undefined
        ? Math.max(0, Number(body.percentage_discount_amount || 0))
        : Number(current.percentage_discount_amount || 0)
    const total = Number(
      (
        subtotal -
        discountAmount -
        percentageDiscountAmount +
        Number(current.minimum_charge_adjustment || 0) +
        Number(current.tax_amount || 0)
      ).toFixed(2),
    )

    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .update({
        subtotal: Number(subtotal.toFixed(2)),
        total,
        discount_amount: discountAmount,
        percentage_discount_amount: percentageDiscountAmount,
        percentage_discount_label:
          body.percentage_discount_label !== undefined
            ? body.percentage_discount_label
            : current.percentage_discount_label,
        percentage_discount_percent:
          body.percentage_discount_percent !== undefined
            ? Math.max(0, Number(body.percentage_discount_percent || 0))
            : Number(current.percentage_discount_percent || 0),
        percentage_discount_scope:
          body.percentage_discount_scope !== undefined
            ? body.percentage_discount_scope
            : current.percentage_discount_scope,
        status:
          body.status !== undefined ? String(body.status) : current.status,
        payment_status:
          body.payment_status !== undefined
            ? body.payment_status
            : body.status === 'paid'
              ? 'paid'
              : current.payment_status,
        payment_method:
          body.payment_method !== undefined
            ? body.payment_method
            : current.payment_method,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (invoiceError) throw invoiceError

    const isBeingMarkedPaid =
      body.status === 'paid' && current.status !== 'paid'
    const method = body.payment_method || current.payment_method

    // NOTE: Marking an invoice paid in the app no longer records a payment in
    // QuickBooks. The payment-method selection is an internal record only;
    // invoices stay open/unpaid in QB so Charles reconciles payments there.
    // (Cash is still handled separately below — it's kept out of QB entirely.)

    // Cash stays in-app only: remove any QuickBooks invoice/payment linkage.
    if (
      isBeingMarkedPaid &&
      method === 'cash' &&
      current.quickbooks_invoice_id
    ) {
      try {
        await voidQBInvoice(current.quickbooks_invoice_id)
        await supabase
          .from('ops_invoices')
          .update({
            quickbooks_invoice_id: null,
            sync_status: 'held',
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
        await supabase
          .from('ops_quickbooks_sync_jobs')
          .delete()
          .eq('entity_type', 'invoice')
          .eq('entity_id', id)
      } catch (qbErr) {
        console.error(
          '[ops/invoices/:id][PATCH] QB void for cash payment failed:',
          qbErr,
        )
      }
    }

    if (current.appointment_id) {
      const { error: appointmentError } = await supabase
        .from('ops_appointments')
        .update({
          quoted_total: Number(subtotal.toFixed(2)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', current.appointment_id)

      if (appointmentError) throw appointmentError
    }

    if (current.appointment_id && !invoice.quickbooks_invoice_id) {
      await ensureInvoiceQuickBooksSyncJob(supabase, id)
      void syncAppointmentToQuickBooks(current.appointment_id).catch((qbErr) =>
        console.error('[ops/invoices/:id][PATCH] QB sync:', qbErr),
      )
    }

    const lineOrDiscountChanged =
      (lineItemsInBody && !dangerousEmpty) ||
      body.discount_amount !== undefined ||
      body.percentage_discount_amount !== undefined
    if (
      current.quickbooks_invoice_id &&
      lineOrDiscountChanged &&
      !isBeingMarkedPaid &&
      invoice.status !== 'paid'
    ) {
      void resyncInvoiceToQuickBooks(id).catch((qbErr) =>
        console.error('[ops/invoices/:id][PATCH] QB invoice resync:', qbErr),
      )
    }

    // Auto-send PDF receipt when a job is marked paid (skip batch-invoice clients)
    if (isBeingMarkedPaid && current.appointment_id) {
      void (async () => {
        try {
          // Check if this appointment belongs to a batch-invoiced recurring template
          const { data: apptRow } = await supabase
            .from('ops_appointments')
            .select(
              `
              appointment_date,
              recurring_template_id,
              ops_recurring_templates ( invoice_mode ),
              ops_customers!ops_appointments_customer_id_fkey ( full_name, business_name, email, phone, email_opt_out ),
              ops_service_addresses ( street_1, city, state, zip_code )
            `,
            )
            .eq('id', current.appointment_id)
            .single()

          const templateMode = (
            apptRow?.ops_recurring_templates as { invoice_mode?: string } | null
          )?.invoice_mode
          const isBatchClient = templateMode === 'batch_monthly'
          if (isBatchClient) return

          const rawCustomer = apptRow?.ops_customers
          const customer = Array.isArray(rawCustomer)
            ? rawCustomer[0]
            : rawCustomer
          const customerEmail = customer?.email ?? null
          if (!customerEmail) return
          if (
            customer?.email_opt_out === true ||
            (customer?.phone && (await isBlacklisted(customer.phone)))
          ) {
            return
          }

          const customerName =
            customer?.business_name || customer?.full_name || 'Valued Customer'

          const rawAddress = apptRow?.ops_service_addresses
          const address = Array.isArray(rawAddress) ? rawAddress[0] : rawAddress
          const serviceAddress = address
            ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
            : ''

          // Fetch refreshed line items for the receipt PDF
          const { data: receiptLines } = await supabase
            .from('ops_invoice_line_items')
            .select('description, quantity, unit_price, line_total')
            .eq('invoice_id', id)

          const lineItems = (receiptLines || []) as Array<{
            description: string
            quantity: number
            unit_price: number
            line_total: number
          }>

          const pdfBuffer = await generateInvoicePDF({
            invoiceId: id,
            isPaid: true,
            paymentMethod: method,
            customerName,
            serviceAddress,
            serviceDate: apptRow?.appointment_date ?? '',
            lineItems,
            discountAmount: discountAmount + percentageDiscountAmount,
            subtotal: Number(subtotal.toFixed(2)),
            total,
          })

          const resendKey = process.env.RESEND_API_KEY
          if (!resendKey) return

          const resend = new Resend(resendKey)
          const fromEmail =
            process.env.OPS_EMAIL_FROM ||
            'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
          const shortRef = `INV-${id.replace(/-/g, '').slice(-6).toUpperCase()}`

          await resend.emails.send({
            from: fromEmail,
            to: customerEmail,
            subject: `Payment received — thank you, ${customerName.split(' ')[0]}!`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:520px;margin:32px auto;color:#111827;">
                <div style="background:#16a34a;padding:20px 28px;border-radius:8px 8px 0 0;">
                  <h1 style="margin:0;color:#fff;font-size:20px;">Sasquatch Carpet Cleaning</h1>
                  <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;">Payment Confirmed</p>
                </div>
                <div style="border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 8px 8px;">
                  <p style="margin:0 0 12px;font-size:15px;">Hi ${customerName.split(' ')[0]},</p>
                  <p style="margin:0 0 20px;font-size:14px;color:#374151;">
                    We've received your payment of <strong>$${total.toFixed(2)}</strong>. Your receipt is attached to this email as a PDF for your records.
                  </p>
                  <p style="margin:0;font-size:13px;color:#6b7280;">
                    Thank you for choosing Sasquatch Carpet Cleaning! We hope to see you again.
                  </p>
                </div>
              </div>`,
            attachments: pdfBuffer
              ? [{ filename: `${shortRef}-receipt.pdf`, content: pdfBuffer }]
              : undefined,
          })
        } catch (receiptErr) {
          console.error(
            '[ops/invoices/:id][PATCH] Receipt email failed:',
            receiptErr,
          )
        }
      })()
    }

    return NextResponse.json({ invoice })
  } catch (error) {
    console.error('[ops/invoices/:id][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update invoice' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data: current, error: currentError } = await supabase
      .from('ops_invoices')
      .select('id, appointment_id, quickbooks_invoice_id')
      .eq('id', id)
      .single()

    if (currentError) throw currentError

    // Void the invoice in QuickBooks if it was synced
    if (current?.quickbooks_invoice_id) {
      try {
        await voidQBInvoice(current.quickbooks_invoice_id)
      } catch (qbErr) {
        console.error('[ops/invoices/:id][DELETE] QB void failed:', qbErr)
        // Don't block the delete if QB void fails
      }
    }

    const { error: deleteError } = await supabase
      .from('ops_invoices')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    const { error: cleanupError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .delete()
      .eq('entity_type', 'invoice')
      .eq('entity_id', id)

    if (cleanupError) throw cleanupError

    if (current?.appointment_id) {
      const { error: appointmentUpdateError } = await supabase
        .from('ops_appointments')
        .update({
          updated_at: new Date().toISOString(),
          quickbooks_sync_status: 'held',
        })
        .eq('id', current.appointment_id)

      if (appointmentUpdateError) throw appointmentUpdateError
    }

    return NextResponse.json({
      success: true,
      appointment_id: current?.appointment_id || null,
    })
  } catch (error) {
    console.error('[ops/invoices/:id][DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete invoice' },
      { status: 500 },
    )
  }
}
