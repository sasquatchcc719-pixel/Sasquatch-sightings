import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { isMonthlyRestorationSnapshot } from '@/lib/ops/monthly-restoration-billing'

const lineDescription = (lines: unknown): string =>
  (Array.isArray(lines) ? lines : [])
    .map((line) => {
      const item = line as { notes?: string | null; name_snapshot?: string }
      return item.notes || item.name_snapshot || ''
    })
    .filter(Boolean)
    .join(', ')

/** Reviewable customer-level month end ledger: ordinary jobs and closed losses. */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const month =
      request.nextUrl.searchParams.get('month') ||
      new Date().toISOString().slice(0, 7)
    const monthStart = `${month}-01`
    const [year, mon] = month.split('-').map(Number)
    const nextMonth =
      mon === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(mon + 1).padStart(2, '0')}-01`

    const { data: customers, error: customerError } = await supabase
      .from('ops_customers')
      .select(
        `id, full_name, business_name, billing_mode,
         ops_service_addresses (id, label, street_1, city, state, zip_code)`,
      )
      .eq('billing_mode', 'monthly_consolidated')
      .order('business_name')
    if (customerError) throw customerError
    if (!customers?.length) {
      return NextResponse.json({ month, customers: [] })
    }
    const customerIds = customers.map((customer) => customer.id)
    const lineItems =
      'id, service_catalog_item_id, name_snapshot, notes, quantity, unit_price, duration_minutes, line_total'

    const [appointmentsResult, projectsResult, invoicesResult] =
      await Promise.all([
        supabase
          .from('ops_appointments')
          .select(
            `id, customer_id, service_address_id, recurring_template_id, status, appointment_date,
             ops_service_addresses (street_1, city, state, zip_code),
             ops_appointment_line_items (${lineItems})`,
          )
          .in('customer_id', customerIds)
          .is('restoration_project_id', null)
          .gte('appointment_date', monthStart)
          .lt('appointment_date', nextMonth)
          .order('appointment_date'),
        supabase
          .from('restoration_projects')
          .select(
            'id, customer_id, billing_month, billing_status, billing_snapshot, final_report_sha256, final_report_version, closed_at',
          )
          .in('customer_id', customerIds)
          .eq('billing_month', monthStart)
          .in('billing_status', ['ready', 'batched', 'sent'])
          .order('closed_at'),
        supabase
          .from('ops_batch_invoices')
          .select(
            `id, customer_id, status, sync_status, quickbooks_invoice_id,
             subtotal, discount_amount, total, attachment_status, attachment_error,
             ops_batch_invoice_entries (
               id, entry_type, appointment_id, restoration_project_id,
               service_date, service_address_snapshot, subtotal,
               line_items_snapshot, attachment_status, attachment_error
             )`,
          )
          .in('customer_id', customerIds)
          .eq('month', monthStart),
      ])
    if (appointmentsResult.error) throw appointmentsResult.error
    if (projectsResult.error) throw projectsResult.error
    if (invoicesResult.error) throw invoicesResult.error

    const appointments = appointmentsResult.data ?? []
    const projects = projectsResult.data ?? []
    const invoices = invoicesResult.data ?? []

    const result = customers.map((customer) => {
      const existingInvoice =
        invoices.find((invoice) => invoice.customer_id === customer.id) ?? null
      const frozenEntries = existingInvoice
        ? Array.isArray(existingInvoice.ops_batch_invoice_entries)
          ? existingInvoice.ops_batch_invoice_entries
          : []
        : []

      const jobs = existingInvoice
        ? frozenEntries
            .filter((entry) => entry.entry_type === 'appointment')
            .map((entry) => {
              const lines = Array.isArray(entry.line_items_snapshot)
                ? entry.line_items_snapshot
                : []
              return {
                appointmentId: entry.appointment_id,
                date: entry.service_date,
                status: 'completed',
                total: Number(entry.subtotal),
                templateLabel: 'Completed job',
                description: lineDescription(lines),
                address: entry.service_address_snapshot || '',
                included: true,
                lineItems: lines,
              }
            })
        : appointments
            .filter((appointment) => appointment.customer_id === customer.id)
            .map((appointment) => {
              const lines = Array.isArray(
                appointment.ops_appointment_line_items,
              )
                ? appointment.ops_appointment_line_items
                : []
              const address = Array.isArray(appointment.ops_service_addresses)
                ? appointment.ops_service_addresses[0]
                : appointment.ops_service_addresses
              return {
                appointmentId: appointment.id,
                date: appointment.appointment_date,
                status: appointment.status,
                total: lines.reduce(
                  (sum, line) => sum + Number(line.line_total),
                  0,
                ),
                templateLabel: appointment.recurring_template_id
                  ? 'Recurring job'
                  : 'One-off job',
                description: lineDescription(lines),
                address: address
                  ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
                  : '',
                included: appointment.status === 'completed',
                lineItems: lines,
              }
            })

      const restorations = existingInvoice
        ? frozenEntries
            .filter((entry) => entry.entry_type === 'restoration')
            .map((entry) => {
              const snapshot = isMonthlyRestorationSnapshot(
                entry.line_items_snapshot,
              )
                ? entry.line_items_snapshot
                : null
              return snapshot
                ? {
                    projectId: entry.restoration_project_id,
                    date: snapshot.serviceDate,
                    address: snapshot.serviceAddress,
                    work: snapshot.charges.filter(
                      (line) => line.kind === 'work',
                    ),
                    equipment: snapshot.charges.filter(
                      (line) => line.kind === 'equipment',
                    ),
                    grossSubtotal: snapshot.grossSubtotal,
                    deductibleCredit: snapshot.deductibleCredit,
                    depositApplied: snapshot.depositApplied,
                    amountDue: snapshot.amountDue,
                    refundDueCents: snapshot.refundDueCents,
                    reportSha256: null,
                    reportVersion: null,
                    attachmentStatus: entry.attachment_status,
                    attachmentError: entry.attachment_error,
                    included: true,
                  }
                : null
            })
            .filter(Boolean)
        : projects
            .filter((project) => project.customer_id === customer.id)
            .map((project) => {
              const snapshot = isMonthlyRestorationSnapshot(
                project.billing_snapshot,
              )
                ? project.billing_snapshot
                : null
              return snapshot
                ? {
                    projectId: project.id,
                    date: snapshot.serviceDate,
                    address: snapshot.serviceAddress,
                    work: snapshot.charges.filter(
                      (line) => line.kind === 'work',
                    ),
                    equipment: snapshot.charges.filter(
                      (line) => line.kind === 'equipment',
                    ),
                    grossSubtotal: snapshot.grossSubtotal,
                    deductibleCredit: snapshot.deductibleCredit,
                    depositApplied: snapshot.depositApplied,
                    amountDue: snapshot.amountDue,
                    refundDueCents: snapshot.refundDueCents,
                    reportSha256: project.final_report_sha256,
                    reportVersion: project.final_report_version,
                    attachmentStatus: 'pending',
                    attachmentError: null,
                    included: project.billing_status === 'ready',
                  }
                : null
            })
            .filter(Boolean)

      const completedJobs = jobs.filter((job) => job.status === 'completed')
      const runningTotal = existingInvoice
        ? Number(existingInvoice.total)
        : completedJobs.reduce((sum, job) => sum + Number(job.total), 0) +
          restorations.reduce(
            (sum, project) => sum + Number(project?.amountDue ?? 0),
            0,
          )

      return {
        customerId: customer.id,
        customerName: customer.full_name || 'Unknown',
        businessName: customer.business_name || null,
        billingMode: customer.billing_mode,
        addresses: customer.ops_service_addresses ?? [],
        visits: jobs,
        jobs,
        restorations,
        totalVisits: jobs.length,
        completedVisits: completedJobs.length,
        runningTotal,
        existingInvoice,
      }
    })

    return NextResponse.json({ month, customers: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
