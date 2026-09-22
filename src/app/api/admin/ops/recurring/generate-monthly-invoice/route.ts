import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { syncBatchInvoiceToQuickBooks } from '@/lib/quickbooks-api'
import {
  isMonthlyRestorationSnapshot,
  reconcileBatchAmounts,
} from '@/lib/ops/monthly-restoration-billing'
import { createAdminClient } from '@/supabase/server'
import { ensureBatchInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'

const addressText = (value: unknown): string => {
  const address = Array.isArray(value) ? value[0] : value
  if (!address || typeof address !== 'object') return ''
  const row = address as {
    street_1?: string
    street_2?: string | null
    city?: string
    state?: string
    zip_code?: string
  }
  return `${row.street_1 ?? ''}${row.street_2 ? `, ${row.street_2}` : ''}, ${row.city ?? ''}, ${row.state ?? ''} ${row.zip_code ?? ''}`.trim()
}

/** Freeze the reviewed selection, then create/sync exactly one monthly invoice. */
export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = (await request.json()) as {
      customerId?: string
      month?: string
      appointmentIds?: string[]
      restorationProjectIds?: string[]
    }
    if (!body.customerId || !body.month) {
      return NextResponse.json(
        { error: 'customerId and month are required' },
        { status: 400 },
      )
    }
    const customerId = body.customerId
    const monthStart = `${body.month.slice(0, 7)}-01`
    const [year, mon] = body.month.slice(0, 7).split('-').map(Number)
    const nextMonth =
      mon === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(mon + 1).padStart(2, '0')}-01`

    const { data: customer } = await supabase
      .from('ops_customers')
      .select('id, billing_mode')
      .eq('id', customerId)
      .maybeSingle()
    if (!customer) {
      return NextResponse.json({ error: 'customer_not_found' }, { status: 404 })
    }
    if (customer.billing_mode !== 'monthly_consolidated') {
      return NextResponse.json(
        { error: 'customer_is_not_monthly_consolidated' },
        { status: 409 },
      )
    }

    const { data: existingBatch } = await supabase
      .from('ops_batch_invoices')
      .select('id, quickbooks_invoice_id, status')
      .eq('customer_id', customerId)
      .eq('month', monthStart)
      .maybeSingle()
    if (existingBatch) {
      if (existingBatch.status === 'sent' || existingBatch.status === 'paid') {
        return NextResponse.json(
          { error: 'This monthly invoice has already been sent.' },
          { status: 409 },
        )
      }
      try {
        const quickbooksInvoiceId = await syncBatchInvoiceToQuickBooks(
          existingBatch.id,
        )
        return NextResponse.json({
          batchInvoiceId: existingBatch.id,
          quickbooksInvoiceId,
          retried: true,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'QuickBooks sync failed'
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }

    const selectedAppointments = new Set(body.appointmentIds ?? [])
    const selectedProjects = new Set(body.restorationProjectIds ?? [])
    if (selectedAppointments.size === 0 && selectedProjects.size === 0) {
      return NextResponse.json(
        { error: 'Select at least one completed job or restoration project.' },
        { status: 400 },
      )
    }

    const [appointmentsResult, projectsResult] = await Promise.all([
      selectedAppointments.size
        ? supabase
            .from('ops_appointments')
            .select(
              `id, customer_id, status, appointment_date, restoration_project_id,
               ops_service_addresses (street_1, street_2, city, state, zip_code),
               ops_appointment_line_items (
                 service_catalog_item_id, name_snapshot, notes, quantity,
                 unit_price, duration_minutes, line_total
               )`,
            )
            .in('id', [...selectedAppointments])
            .eq('customer_id', customerId)
            .eq('status', 'completed')
            .is('restoration_project_id', null)
            .gte('appointment_date', monthStart)
            .lt('appointment_date', nextMonth)
        : Promise.resolve({ data: [], error: null }),
      selectedProjects.size
        ? supabase
            .from('restoration_projects')
            .select(
              'id, customer_id, billing_month, billing_status, billing_snapshot, final_report_storage_path, final_report_sha256, final_report_version',
            )
            .in('id', [...selectedProjects])
            .eq('customer_id', customerId)
            .eq('billing_month', monthStart)
            .eq('billing_status', 'ready')
        : Promise.resolve({ data: [], error: null }),
    ])
    if (appointmentsResult.error) throw appointmentsResult.error
    if (projectsResult.error) throw projectsResult.error

    const appointments = appointmentsResult.data ?? []
    const projects = projectsResult.data ?? []
    if (appointments.length !== selectedAppointments.size) {
      return NextResponse.json(
        { error: 'One or more selected jobs are no longer eligible.' },
        { status: 409 },
      )
    }
    if (projects.length !== selectedProjects.size) {
      return NextResponse.json(
        {
          error:
            'One or more selected restoration projects are no longer ready.',
        },
        { status: 409 },
      )
    }

    const restorationSnapshots = projects.map((project) => {
      if (!isMonthlyRestorationSnapshot(project.billing_snapshot)) {
        throw new Error(
          `Restoration ${project.id} has an invalid billing snapshot`,
        )
      }
      if (
        !project.final_report_storage_path ||
        !project.final_report_sha256 ||
        !project.final_report_version
      ) {
        throw new Error(`Restoration ${project.id} has no frozen final report`)
      }
      return project.billing_snapshot
    })
    const appointmentSubtotals = appointments.map((appointment) =>
      (Array.isArray(appointment.ops_appointment_line_items)
        ? appointment.ops_appointment_line_items
        : []
      ).reduce((sum, line) => sum + Number(line.line_total), 0),
    )
    const amounts = reconcileBatchAmounts({
      appointmentSubtotals,
      restorationSnapshots,
    })

    const { data: batchInvoice, error: batchError } = await supabase
      .from('ops_batch_invoices')
      .insert({
        template_id: null,
        customer_id: customerId,
        month: monthStart,
        status: 'ready',
        subtotal: amounts.subtotal,
        discount_amount: amounts.discountAmount,
        total: amounts.total,
        sync_status: 'pending',
        attachment_status: projects.length ? 'pending' : 'not_required',
      })
      .select('id')
      .single()
    if (batchError || !batchInvoice) {
      throw new Error(batchError?.message ?? 'batch_invoice_insert_failed')
    }

    const entries = [
      ...appointments.map((appointment, index) => ({
        batch_invoice_id: batchInvoice.id,
        entry_type: 'appointment',
        appointment_id: appointment.id,
        restoration_project_id: null,
        service_date: appointment.appointment_date,
        service_address_snapshot: addressText(
          appointment.ops_service_addresses,
        ),
        line_items_snapshot: appointment.ops_appointment_line_items ?? [],
        subtotal: Number(appointmentSubtotals[index].toFixed(2)),
        attachment_status: 'not_required',
      })),
      ...projects.map((project, index) => ({
        batch_invoice_id: batchInvoice.id,
        entry_type: 'restoration',
        appointment_id: null,
        restoration_project_id: project.id,
        service_date: restorationSnapshots[index].serviceDate,
        service_address_snapshot: restorationSnapshots[index].serviceAddress,
        line_items_snapshot: restorationSnapshots[index],
        subtotal: restorationSnapshots[index].grossSubtotal,
        attachment_status: 'pending',
      })),
    ]
    const { error: entryError } = await supabase
      .from('ops_batch_invoice_entries')
      .insert(entries)
    if (entryError) {
      await supabase
        .from('ops_batch_invoices')
        .delete()
        .eq('id', batchInvoice.id)
      throw new Error(entryError.message)
    }

    if (projects.length) {
      const { error: projectUpdateError } = await supabase
        .from('restoration_projects')
        .update({
          billing_status: 'batched',
          updated_at: new Date().toISOString(),
        })
        .in(
          'id',
          projects.map((project) => project.id),
        )
        .eq('billing_status', 'ready')
      if (projectUpdateError) throw projectUpdateError
    }

    await ensureBatchInvoiceQuickBooksSyncJob(supabase, batchInvoice.id)

    try {
      const quickbooksInvoiceId = await syncBatchInvoiceToQuickBooks(
        batchInvoice.id,
      )
      await supabase
        .from('ops_quickbooks_sync_jobs')
        .update({
          status: 'synced',
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('entity_type', 'batch_invoice')
        .eq('entity_id', batchInvoice.id)
      return NextResponse.json({
        batchInvoiceId: batchInvoice.id,
        quickbooksInvoiceId,
        appointmentCount: appointments.length,
        restorationCount: projects.length,
        ...amounts,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'QuickBooks sync failed'
      return NextResponse.json(
        { error: message, batchInvoiceId: batchInvoice.id },
        { status: 502 },
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
