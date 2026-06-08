import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
} from '@/lib/ops/availability'
import {
  getOnMyWaySmsRenderedBody,
  sendOpsLifecycleCommunications,
} from '@/lib/ops/communications'
import { enrollCustomerInDrip } from '@/lib/ops/drip-campaign'
import { getQuickBooksSyncStatus } from '@/lib/quickbooks'
import {
  resyncInvoiceToQuickBooks,
  syncAppointmentToQuickBooks,
} from '@/lib/quickbooks-api'
import { ensureInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import { recordRevenueFromOpsInvoice } from '@/lib/ops/revenue-from-invoice'
import { sendCustomerSMS } from '@/lib/twilio'
import { Resend } from 'resend'
import {
  leadSourceUpdatePayload,
  normalizeLeadSourceForWrite,
} from '@/lib/server/lead-sources'

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
}

/** Normalize any "HH:MM" or "HH:MM:SS" input for Postgres time columns. */
function toDbTime(value: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim())
  if (!m) return '09:00:00'
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  const sec = m[3] != null ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function parseClockMinutes(value: string): number {
  const [h, m] = toDbTime(value).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const APPOINTMENT_SELECT = `
  *,
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
    phone,
    notes
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
  ops_appointment_line_items (
    id,
    service_catalog_item_id,
    name_snapshot,
    quantity,
    unit_price,
    duration_minutes,
    buffer_minutes,
    line_total,
    notes,
    pricing_unit_snapshot
  ),
  ops_invoices (
    id,
    status,
    payment_status,
    sync_status,
    subtotal,
    total,
    quickbooks_invoice_id,
    ops_invoice_line_items (
      id,
      appointment_line_item_id,
      description,
      quantity,
      unit_price,
      line_total
    )
  )
`

async function sendAppointmentCancellationNotifications(
  supabase: ReturnType<typeof createAdminClient>,
  appointmentId: string,
) {
  const { data: appointment, error: appointmentError } = await supabase
    .from('ops_appointments')
    .select(
      `
        id,
        appointment_date,
        start_time,
        ops_customers!ops_appointments_customer_id_fkey (
          full_name,
          first_name,
          email,
          phone
        ),
        ops_service_addresses (
          street_1,
          city,
          state,
          zip_code
        )
      `,
    )
    .eq('id', appointmentId)
    .single()

  if (appointmentError) throw appointmentError

  const customer = Array.isArray(appointment.ops_customers)
    ? appointment.ops_customers[0]
    : appointment.ops_customers
  const address = Array.isArray(appointment.ops_service_addresses)
    ? appointment.ops_service_addresses[0]
    : appointment.ops_service_addresses

  if (!customer) return { requested: false, sent: [] as string[] }

  const firstName =
    customer.first_name || customer.full_name?.split(' ')[0] || 'there'
  const dateStr = appointment.appointment_date
  const addressStr = address ? `${address.street_1}, ${address.city}` : ''

  const smsBody = [
    `Hi ${firstName} — your Sasquatch Carpet Cleaning appointment`,
    dateStr ? ` on ${dateStr}` : '',
    addressStr ? ` at ${addressStr}` : '',
    ` has been cancelled.`,
    `\n\nTo rebook, visit sasquatchcarpet.com or call/text us at (719) 249-8791.`,
  ].join('')

  const notifications: Promise<string>[] = []

  if (customer.phone) {
    notifications.push(
      sendCustomerSMS(customer.phone, smsBody, undefined, 'job_cancelled').then(
        () => 'sms',
      ),
    )
  }

  if (customer.email) {
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const resend = new Resend(resendKey)
      const fromEmail =
        process.env.OPS_EMAIL_FROM ||
        'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
      notifications.push(
        resend.emails
          .send(
            {
              from: fromEmail,
              to: customer.email,
              subject:
                'Your Sasquatch Carpet Cleaning appointment has been cancelled',
              html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
  <h2 style="color:#16a34a;">Appointment Cancelled</h2>
  <p>Hi ${firstName},</p>
  <p>Your appointment${dateStr ? ` on <strong>${dateStr}</strong>` : ''}${addressStr ? ` at ${addressStr}` : ''} has been cancelled.</p>
  <p>We apologize for any inconvenience. To rebook, visit our website or give us a call.</p>
  <a href="https://sasquatchcarpet.com" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Rebook Now</a>
  <p style="margin-top:20px;color:#6b7280;font-size:13px;">Questions? Call or text us at (719) 249-8791.</p>
</div>`,
            },
            { idempotencyKey: `job-cancelled/${appointment.id}` },
          )
          .then(({ error }) => {
            if (error) throw new Error(error.message)
            return 'email'
          }),
      )
    }
  }

  const results = await Promise.allSettled(notifications)
  const sent = results
    .filter((result): result is PromiseFulfilledResult<string> => {
      if (result.status === 'rejected') {
        console.error('[ops/appointments/:id][cancel-notify]', result.reason)
        return false
      }
      return true
    })
    .map((result) => result.value)

  return { requested: notifications.length > 0, sent }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data, error } = await supabase
      .from('ops_appointments')
      .select(APPOINTMENT_SELECT)
      .eq('id', id)
      .single()

    if (error) throw error

    return NextResponse.json({ appointment: data })
  } catch (error) {
    console.error('[ops/appointments/:id][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load appointment' },
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

    const { data: current, error: currentError } = await supabase
      .from('ops_appointments')
      .select(
        `
          *,
          ops_appointment_line_items (
            duration_minutes,
            buffer_minutes,
            quantity
          )
        `,
      )
      .eq('id', id)
      .single()

    if (currentError) throw currentError

    const appointmentDate = body.appointment_date
      ? String(body.appointment_date).trim()
      : current.appointment_date

    const normStartStr = (t: string) => toDbTime(t).slice(0, 5)
    const nextStartDb = toDbTime(
      body.start_time != null
        ? String(body.start_time)
        : String(current.start_time),
    )

    const startChanged =
      body.start_time != null &&
      normStartStr(String(body.start_time)) !==
        normStartStr(String(current.start_time))
    const dateChanged =
      body.appointment_date != null &&
      String(body.appointment_date).trim() !== String(current.appointment_date)

    const totalMinutesFromLines = (
      current.ops_appointment_line_items || []
    ).reduce(
      (
        sum: number,
        item: {
          duration_minutes: number
          buffer_minutes: number
          quantity: number
          unit_price: number
          name_snapshot: string
          pricing_unit_snapshot?: string | null
        },
      ) =>
        sum +
        calculateLineItemDurationMinutes({
          durationMinutes: Number(item.duration_minutes),
          quantity: Number(item.quantity),
          pricingUnit: item.pricing_unit_snapshot ?? null,
          unitPrice: Number(item.unit_price),
          nameSnapshot: String(item.name_snapshot || ''),
        }),
      0,
    )
    const totalMinutesWithBuffer = applyAppointmentBuffer(totalMinutesFromLines)

    const explicitEndInput =
      typeof body.end_time === 'string' && String(body.end_time).trim() !== ''
    const recalcFromLines = body.recalculate_end_from_line_items === true

    let nextEndDb: string
    if (recalcFromLines && totalMinutesFromLines > 0) {
      nextEndDb = addMinutesToTime(
        nextStartDb.slice(0, 5),
        totalMinutesWithBuffer,
      )
    } else if (explicitEndInput) {
      nextEndDb = toDbTime(String(body.end_time))
      if (parseClockMinutes(nextEndDb) <= parseClockMinutes(nextStartDb)) {
        return NextResponse.json(
          { error: 'End time must be after start time' },
          { status: 400 },
        )
      }
    } else if (startChanged || dateChanged) {
      const delta =
        parseClockMinutes(String(current.end_time)) -
        parseClockMinutes(String(current.start_time))
      const safeDelta = Math.max(delta, 15)
      nextEndDb = addMinutesToTime(nextStartDb.slice(0, 5), safeDelta)
    } else {
      nextEndDb = toDbTime(String(current.end_time))
    }

    const nextStatus = body.status ? String(body.status) : current.status
    const nextPaymentStatus = body.payment_status
      ? String(body.payment_status)
      : current.payment_status
    const normalizedLeadSource =
      body.lead_source !== undefined || body.lead_source_key !== undefined
        ? await normalizeLeadSourceForWrite({
            supabase,
            sourceKey: body.lead_source_key,
            legacyValue: body.lead_source,
            detail: body.lead_source_detail,
            requireActive: true,
            requirePublic: false,
            allowMissingDetail: true,
          })
        : null

    if (normalizedLeadSource && !normalizedLeadSource.ok) {
      return NextResponse.json(
        { error: normalizedLeadSource.error },
        { status: 400 },
      )
    }

    const nowIso = new Date().toISOString()
    const firstOnMyWayAt =
      (current as { on_my_way_at?: string | null }).on_my_way_at ?? null
    const completedAtExisting =
      (current as { completed_at?: string | null }).completed_at ?? null

    // Allow admin to explicitly override on_my_way_at (e.g. duration correction from recurring manager)
    const nextOnMyWayAt =
      body.on_my_way_at !== undefined
        ? (body.on_my_way_at as string | null)
        : nextStatus === 'on_my_way' && !firstOnMyWayAt
          ? nowIso
          : firstOnMyWayAt
    const nextCompletedAt =
      nextStatus === 'completed' && !completedAtExisting
        ? nowIso
        : completedAtExisting

    // Re-link to (or detach from) a recurring series — only owner/dispatcher/admin.
    // Validates template customer_id + service_address_id match the job.
    let nextRecurringTemplateId: string | null | undefined
    if (Object.prototype.hasOwnProperty.call(body, 'recurring_template_id')) {
      if (!['admin', 'owner', 'dispatcher'].includes(String(access.role))) {
        return NextResponse.json(
          { error: 'Not authorized to change recurring template link' },
          { status: 403 },
        )
      }
      if (body.recurring_template_id === null) {
        nextRecurringTemplateId = null
      } else {
        const tid = String(body.recurring_template_id).trim()
        if (!tid) {
          return NextResponse.json(
            { error: 'Invalid recurring_template_id' },
            { status: 400 },
          )
        }
        const { data: tpl, error: tplErr } = await supabase
          .from('ops_recurring_templates')
          .select('id, customer_id, service_address_id')
          .eq('id', tid)
          .maybeSingle()
        if (tplErr || !tpl) {
          return NextResponse.json(
            { error: 'Recurring template not found' },
            { status: 400 },
          )
        }
        if (
          tpl.customer_id !== current.customer_id ||
          tpl.service_address_id !== current.service_address_id
        ) {
          return NextResponse.json(
            {
              error:
                'That template is for a different customer or service address than this job',
            },
            { status: 400 },
          )
        }
        nextRecurringTemplateId = tid
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('ops_appointments')
      .update({
        appointment_date: appointmentDate,
        start_time: nextStartDb,
        end_time: nextEndDb,
        status: nextStatus,
        payment_status: nextPaymentStatus,
        internal_notes:
          body.internal_notes !== undefined
            ? String(body.internal_notes || '').trim() || null
            : current.internal_notes,
        ...(normalizedLeadSource?.ok
          ? leadSourceUpdatePayload(normalizedLeadSource.source)
          : {
              lead_source: current.lead_source,
              lead_source_key: current.lead_source_key,
              lead_source_detail: current.lead_source_detail,
              original_lead_source: current.original_lead_source,
            }),
        assigned_staff_user_id:
          body.assigned_staff_user_id !== undefined
            ? body.assigned_staff_user_id || null
            : current.assigned_staff_user_id,
        on_my_way_at: nextOnMyWayAt,
        completed_at: nextCompletedAt,
        updated_at: nowIso,
        ...(nextRecurringTemplateId !== undefined
          ? { recurring_template_id: nextRecurringTemplateId }
          : {}),
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    const effRecurringTid =
      (updated as { recurring_template_id?: string | null })
        .recurring_template_id ?? null

    // Handle line item updates (for recurring batch visit editing)
    if (Array.isArray(body.line_items)) {
      await supabase
        .from('ops_appointment_line_items')
        .delete()
        .eq('appointment_id', id)

      let insertedApptLines: Array<{
        id: string
        name_snapshot: string
        quantity: number
        unit_price: number
        line_total: number
      }> = []

      if (body.line_items.length > 0) {
        const lineItemsPayload = (
          body.line_items as Array<{
            service_catalog_item_id?: string | null
            name_snapshot?: string
            quantity?: number | string
            unit_price?: number | string
            duration_minutes?: number | string
            notes?: string | null
          }>
        ).map((item) => {
          const qty = Math.max(1, Number(item.quantity) || 1)
          const price = Math.max(0, Number(item.unit_price) || 0)
          return {
            appointment_id: id,
            service_catalog_item_id: item.service_catalog_item_id || null,
            name_snapshot: String(item.name_snapshot || '').trim() || 'Service',
            quantity: qty,
            unit_price: price,
            duration_minutes: Math.max(1, Number(item.duration_minutes) || 60),
            buffer_minutes: 0,
            line_total: qty * price,
            notes: item.notes ? String(item.notes).trim() || null : null,
          }
        })

        const { data: apptLines, error: lineItemsErr } = await supabase
          .from('ops_appointment_line_items')
          .insert(lineItemsPayload)
          .select('id, name_snapshot, quantity, unit_price, line_total')

        if (lineItemsErr) throw lineItemsErr
        insertedApptLines = apptLines || []
      }

      const newTotal = (
        body.line_items as Array<{
          quantity?: number | string
          unit_price?: number | string
        }>
      ).reduce(
        (sum, l) =>
          sum + (Number(l.quantity) || 1) * (Number(l.unit_price) || 0),
        0,
      )

      await supabase
        .from('ops_appointments')
        .update({ quoted_total: newTotal, updated_at: nowIso })
        .eq('id', id)

      // Keep ops_invoices in sync with the calendar (previously only
      // quoted_total changed, so QuickBooks kept the old amount).
      const { data: invRow } = await supabase
        .from('ops_invoices')
        .select(
          'id, discount_amount, percentage_discount_amount, tax_amount, minimum_charge_adjustment, quickbooks_invoice_id, status',
        )
        .eq('appointment_id', id)
        .maybeSingle()

      if (invRow) {
        await supabase
          .from('ops_invoice_line_items')
          .delete()
          .eq('invoice_id', invRow.id)

        if (insertedApptLines.length > 0) {
          const { error: invLinesErr } = await supabase
            .from('ops_invoice_line_items')
            .insert(
              insertedApptLines.map((line) => ({
                invoice_id: invRow.id,
                appointment_line_item_id: line.id,
                description: line.name_snapshot,
                quantity: line.quantity,
                unit_price: line.unit_price,
                line_total: line.line_total,
              })),
            )
          if (invLinesErr) throw invLinesErr
        }

        const discountAmount = Number(invRow.discount_amount || 0)
        const percentageDiscountAmount = Number(
          invRow.percentage_discount_amount || 0,
        )
        const subtotal = Number(newTotal.toFixed(2))
        const total = Number(
          (
            subtotal -
            discountAmount -
            percentageDiscountAmount +
            Number(invRow.minimum_charge_adjustment || 0) +
            Number(invRow.tax_amount || 0)
          ).toFixed(2),
        )

        await supabase
          .from('ops_invoices')
          .update({
            subtotal,
            total,
            updated_at: nowIso,
          })
          .eq('id', invRow.id)

        if (invRow.quickbooks_invoice_id) {
          void resyncInvoiceToQuickBooks(invRow.id).catch((qbErr) =>
            console.error(
              '[ops/appointments/:id][PATCH] QB invoice resync:',
              qbErr,
            ),
          )
        }
      }
    }

    if (
      current.status !== nextStatus ||
      current.payment_status !== nextPaymentStatus
    ) {
      await supabase.from('ops_appointment_status_events').insert({
        appointment_id: id,
        from_status: current.status,
        to_status: nextStatus,
        changed_by: access.id,
        notes: 'Appointment updated from operations job detail',
      })
    }

    // Determine if this is a batch_monthly recurring appointment — skip
    // lifecycle notifications and QB sync for commercial batch clients.
    let isBatchMonthlyRecurring = false
    if (effRecurringTid && current.status !== nextStatus) {
      const { data: tplMeta } = await supabase
        .from('ops_recurring_templates')
        .select('invoice_mode')
        .eq('id', effRecurringTid)
        .maybeSingle()
      isBatchMonthlyRecurring = tplMeta?.invoice_mode === 'batch_monthly'
    }

    let lifecycleNotifications: {
      template_key: string
      channel: 'sms' | 'email'
      body: string
      actually_sent?: boolean
    }[] = []
    let cancellationNotifications: Awaited<
      ReturnType<typeof sendAppointmentCancellationNotifications>
    > | null = null

    if (current.status !== nextStatus && !isBatchMonthlyRecurring) {
      if (nextStatus === 'on_my_way') {
        const { sent } = await sendOpsLifecycleCommunications({
          event: 'on_my_way',
          appointmentId: id,
        })
        lifecycleNotifications = sent.map((n) => ({
          ...n,
          actually_sent:
            n.channel === 'sms' ? (n.actually_sent ?? true) : undefined,
        }))
        const hasSms = lifecycleNotifications.some((n) => n.channel === 'sms')
        if (!hasSms) {
          const previewBody = await getOnMyWaySmsRenderedBody(id)
          if (previewBody != null) {
            lifecycleNotifications.push({
              template_key: 'on_my_way_sms',
              channel: 'sms',
              body: previewBody,
              actually_sent: false,
            })
          }
        }
      } else if (nextStatus === 'completed') {
        const { sent } = await sendOpsLifecycleCommunications({
          event: 'job_finished',
          appointmentId: id,
        })
        lifecycleNotifications = sent

        if (!effRecurringTid) {
          enrollCustomerInDrip(id).catch((err) =>
            console.error('[drip] enrollment error:', err),
          )
        }
      }
    }

    if (
      current.status !== nextStatus &&
      nextStatus === 'cancelled' &&
      body.notify_customer === true &&
      !isBatchMonthlyRecurring
    ) {
      cancellationNotifications =
        await sendAppointmentCancellationNotifications(supabase, id)
    }

    if (nextStatus === 'completed' && !isBatchMonthlyRecurring) {
      const { data: inv } = await supabase
        .from('ops_invoices')
        .select('id, status')
        .eq('appointment_id', id)
        .maybeSingle()

      if (inv?.status === 'draft') {
        await supabase
          .from('ops_invoices')
          .update({
            status: 'ready',
            sync_status: getQuickBooksSyncStatus(),
            updated_at: nowIso,
          })
          .eq('id', inv.id)
        await supabase.from('ops_invoice_status_events').insert({
          invoice_id: inv.id,
          from_status: 'draft',
          to_status: 'ready',
          changed_by: access.id,
          notes: 'Job completed from operations',
        })
      }

      if (inv?.id) {
        await ensureInvoiceQuickBooksSyncJob(supabase, inv.id)
      }

      void syncAppointmentToQuickBooks(id).catch((qbErr) =>
        console.error('[ops/appointments/:id][PATCH] QB sync:', qbErr),
      )
    }

    // Auto-record revenue stats whenever a job is closed. Idempotent.
    if (nextStatus === 'completed' && current.status !== 'completed') {
      const { data: invForStats } = await supabase
        .from('ops_invoices')
        .select('id')
        .eq('appointment_id', id)
        .maybeSingle()

      if (invForStats?.id) {
        // Standard invoiced job — use the invoice-based recorder (handles
        // line item totals, wall-clock hours, etc.)
        const statsResult = await recordRevenueFromOpsInvoice(supabase, {
          invoiceId: invForStats.id,
          userId: access.id,
        })
        if (!statsResult.ok) {
          console.error(
            '[ops/appointments/:id][PATCH] auto-record-stats:',
            statsResult.error,
          )
        }
      } else {
        // No invoice (e.g. batch_monthly recurring like Recovery Village) —
        // record directly from appointment line items. Skip if already exists.
        try {
          const { data: existingEntry } = await supabase
            .from('revenue_entries')
            .select('id')
            .eq('ops_appointment_id', id)
            .maybeSingle()
          if (!existingEntry?.id) {
            const { data: apptForStats } = await supabase
              .from('ops_appointments')
              .select(
                `
                appointment_date,
                quoted_total,
                on_my_way_at,
                completed_at,
                start_time,
                end_time,
                ops_appointment_line_items ( name_snapshot, line_total )
              `,
              )
              .eq('id', id)
              .single()

            if (!apptForStats)
              throw new Error('Appointment not found for stats')

            const lineItems = Array.isArray(
              apptForStats.ops_appointment_line_items,
            )
              ? apptForStats.ops_appointment_line_items
              : apptForStats.ops_appointment_line_items
                ? [apptForStats.ops_appointment_line_items]
                : []

            const invoiceAmount =
              lineItems.reduce(
                (sum: number, li: { line_total: number }) =>
                  sum + Number(li.line_total || 0),
                0,
              ) || Number(apptForStats.quoted_total || 0)

            let hoursWorked = 0
            const omwAt = apptForStats.on_my_way_at as string | null
            const doneAt = apptForStats.completed_at as string | null
            if (omwAt && doneAt) {
              const wallMs =
                new Date(doneAt).getTime() - new Date(omwAt).getTime()
              const wallHrs = wallMs / (1000 * 60 * 60)
              // Only trust wall-clock if it's at least 15 minutes
              if (wallHrs >= 0.25) hoursWorked = wallHrs
            }
            if (
              hoursWorked === 0 &&
              apptForStats.start_time &&
              apptForStats.end_time
            ) {
              const [sh, sm] = String(apptForStats.start_time)
                .split(':')
                .map(Number)
              const [eh, em] = String(apptForStats.end_time)
                .split(':')
                .map(Number)
              hoursWorked = Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60)
            }

            const description =
              lineItems
                .map((li: { name_snapshot: string }) => li.name_snapshot)
                .filter(Boolean)
                .join(', ') || 'Ops job'

            await supabase.from('revenue_entries').insert({
              user_id: access.id,
              entry_date:
                apptForStats.appointment_date ||
                new Date().toISOString().split('T')[0],
              description,
              invoice_amount: invoiceAmount,
              hours_worked: hoursWorked,
              ops_appointment_id: id,
            })
          }
        } catch (statsErr) {
          console.error(
            '[ops/appointments/:id][PATCH] auto-record-stats (no-invoice):',
            statsErr,
          )
        }
      }
    }

    return NextResponse.json({
      appointment: updated,
      lifecycle_notifications: lifecycleNotifications,
      cancellation_notifications: cancellationNotifications,
    })
  } catch (error) {
    console.error('[ops/appointments/:id][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update appointment' },
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

    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        appointment_date,
        start_time,
        ops_customers!ops_appointments_customer_id_fkey (
          full_name,
          first_name,
          email,
          phone
        ),
        ops_service_addresses (
          street_1,
          city,
          state,
          zip_code
        )
      `,
      )
      .eq('id', id)
      .single()

    if (appointmentError) throw appointmentError

    // Send cancellation notifications before deleting
    const customer = Array.isArray(appointment.ops_customers)
      ? appointment.ops_customers[0]
      : appointment.ops_customers
    const address = Array.isArray(appointment.ops_service_addresses)
      ? appointment.ops_service_addresses[0]
      : appointment.ops_service_addresses

    if (customer) {
      const firstName =
        customer.first_name || customer.full_name?.split(' ')[0] || 'there'
      const dateStr = appointment.appointment_date
      const addressStr = address ? `${address.street_1}, ${address.city}` : ''

      const smsBody = [
        `Hi ${firstName} — your Sasquatch Carpet Cleaning appointment`,
        dateStr ? ` on ${dateStr}` : '',
        addressStr ? ` at ${addressStr}` : '',
        ` has been cancelled.`,
        `\n\nTo rebook, visit sasquatchcarpet.com or call/text us at (719) 249-8791.`,
      ].join('')

      const notifications: Promise<unknown>[] = []

      if (customer.phone) {
        notifications.push(
          sendCustomerSMS(customer.phone, smsBody, undefined, 'job_cancelled'),
        )
      }

      if (customer.email) {
        const resendKey = process.env.RESEND_API_KEY
        if (resendKey) {
          const resend = new Resend(resendKey)
          const fromEmail =
            process.env.OPS_EMAIL_FROM ||
            'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
          notifications.push(
            resend.emails.send({
              from: fromEmail,
              to: customer.email,
              subject:
                'Your Sasquatch Carpet Cleaning appointment has been cancelled',
              html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
  <h2 style="color:#16a34a;">Appointment Cancelled</h2>
  <p>Hi ${firstName},</p>
  <p>Your appointment${dateStr ? ` on <strong>${dateStr}</strong>` : ''}${addressStr ? ` at ${addressStr}` : ''} has been cancelled.</p>
  <p>We apologize for any inconvenience. To rebook, visit our website or give us a call.</p>
  <a href="https://sasquatchcarpet.com" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Rebook Now</a>
  <p style="margin-top:20px;color:#6b7280;font-size:13px;">Questions? Call or text us at (719) 249-8791.</p>
</div>`,
            }),
          )
        }
      }

      await Promise.allSettled(notifications)
    }

    const { data: invoices, error: invoicesError } = await supabase
      .from('ops_invoices')
      .select('id')
      .eq('appointment_id', id)

    if (invoicesError) throw invoicesError

    const invoiceIds = (invoices || []).map((row) => row.id)
    if (invoiceIds.length > 0) {
      const { error: syncCleanupError } = await supabase
        .from('ops_quickbooks_sync_jobs')
        .delete()
        .eq('entity_type', 'invoice')
        .in('entity_id', invoiceIds)
      if (syncCleanupError) throw syncCleanupError
    }

    const { error: deleteError } = await supabase
      .from('ops_appointments')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    return NextResponse.json({
      success: true,
      appointment_id: appointment.id,
    })
  } catch (error) {
    console.error('[ops/appointments/:id][DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete appointment' },
      { status: 500 },
    )
  }
}
