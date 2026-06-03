import { NextResponse } from 'next/server'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import { getQBConnectionStatus } from '@/lib/quickbooks-auth'
import { createAdminClient } from '@/supabase/server'

type InvoiceSummary = {
  id: string
  invoice_number?: number | string | null
  status?: string | null
  sync_status?: string | null
  payment_method?: string | null
  total?: number | string | null
  created_at?: string | null
  ops_appointments?:
    | {
        id?: string
        appointment_date?: string | null
        start_time?: string | null
        status?: string | null
        kind?: string | null
        ops_customers?:
          | {
              full_name?: string | null
              business_name?: string | null
            }
          | Array<{
              full_name?: string | null
              business_name?: string | null
            }>
          | null
        ops_service_addresses?:
          | {
              city?: string | null
              state?: string | null
            }
          | Array<{
              city?: string | null
              state?: string | null
            }>
          | null
      }
    | Array<{
        id?: string
        appointment_date?: string | null
        start_time?: string | null
        status?: string | null
        kind?: string | null
        ops_customers?:
          | {
              full_name?: string | null
              business_name?: string | null
            }
          | Array<{
              full_name?: string | null
              business_name?: string | null
            }>
          | null
        ops_service_addresses?:
          | {
              city?: string | null
              state?: string | null
            }
          | Array<{
              city?: string | null
              state?: string | null
            }>
          | null
      }>
    | null
}

type PendingJobRow = {
  id: string
  entity_type: 'customer' | 'invoice' | string
  entity_id: string
  payload?: Record<string, unknown> | null
  error_message?: string | null
  created_at?: string | null
  updated_at?: string | null
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function customerNameFromInvoice(invoice: InvoiceSummary) {
  const appointment = unwrapRelation(invoice.ops_appointments)
  const customer = unwrapRelation(appointment?.ops_customers)
  return customer?.business_name || customer?.full_name || 'Unknown customer'
}

function locationFromInvoice(invoice: InvoiceSummary) {
  const appointment = unwrapRelation(invoice.ops_appointments)
  const address = unwrapRelation(appointment?.ops_service_addresses)
  return [address?.city, address?.state].filter(Boolean).join(', ') || null
}

function formatInvoiceSummary(invoice: InvoiceSummary) {
  const appointment = unwrapRelation(invoice.ops_appointments)

  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number ?? null,
    label: invoice.invoice_number
      ? `Invoice #${invoice.invoice_number}`
      : 'Invoice',
    customer_name: customerNameFromInvoice(invoice),
    appointment_date: appointment?.appointment_date ?? null,
    start_time: appointment?.start_time ?? null,
    appointment_status: appointment?.status ?? null,
    invoice_status: invoice.status ?? null,
    payment_method: invoice.payment_method ?? null,
    total: invoice.total == null ? null : Number(invoice.total),
    location: locationFromInvoice(invoice),
    created_at: invoice.created_at ?? null,
    url: `/admin/operations/invoices/${invoice.id}`,
  }
}

export async function GET() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !hasRoleAccess(role, ['admin', 'owner'])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()
    const connectionStatus = await getQBConnectionStatus()

    const [
      pendingResult,
      failedResult,
      syncedResult,
      eligibleInvoicesResult,
      pendingInvoiceJobsResult,
      pendingJobsResult,
    ] = await Promise.all([
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'failed'),
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('updated_at')
        .eq('status', 'synced')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('ops_invoices')
        .select(
          `
          id,
          invoice_number,
          payment_method,
          status,
          sync_status,
          total,
          created_at,
          ops_appointments!inner ( status, kind )
        `,
        )
        .is('quickbooks_invoice_id', null)
        .in('status', ['ready', 'sent', 'paid']),
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('entity_id')
        .eq('entity_type', 'invoice')
        .eq('status', 'pending'),
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select(
          'id, entity_type, entity_id, payload, error_message, created_at, updated_at',
        )
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(25),
    ])

    const pendingInvoiceIds = new Set(
      (pendingInvoiceJobsResult.data || []).map((row) => row.entity_id),
    )
    const stuckInvoiceRows = (eligibleInvoicesResult.data || []).filter(
      (row) => {
        const appointment = Array.isArray(row.ops_appointments)
          ? row.ops_appointments[0]
          : row.ops_appointments
        return (
          appointment?.kind !== 'estimate' &&
          (appointment?.status === 'completed' || row.status === 'paid') &&
          row.sync_status !== 'held' &&
          row.sync_status !== 'synced' &&
          row.payment_method !== 'cash' &&
          !pendingInvoiceIds.has(row.id)
        )
      },
    )
    const detailInvoiceIds = [
      ...new Set([
        ...stuckInvoiceRows.map((invoice) => invoice.id),
        ...((pendingJobsResult.data as PendingJobRow[] | null) || [])
          .filter((job) => job.entity_type === 'invoice')
          .map((job) => job.entity_id),
      ]),
    ]

    let invoiceDetailsById = new Map<
      string,
      ReturnType<typeof formatInvoiceSummary>
    >()
    if (detailInvoiceIds.length > 0) {
      const { data: invoiceDetailRows, error: invoiceDetailError } =
        await supabase
          .from('ops_invoices')
          .select(
            `
            id,
            invoice_number,
            payment_method,
            status,
            total,
            created_at,
            ops_appointments (
              id,
              appointment_date,
              start_time,
              status,
              kind,
              ops_customers!ops_appointments_customer_id_fkey (
                full_name,
                business_name
              ),
              ops_service_addresses (
                city,
                state
              )
            )
          `,
          )
          .in('id', detailInvoiceIds)

      if (invoiceDetailError) throw invoiceDetailError

      invoiceDetailsById = new Map(
        ((invoiceDetailRows || []) as InvoiceSummary[]).map((invoice) => [
          invoice.id,
          formatInvoiceSummary(invoice),
        ]),
      )
    }

    const stuckInvoices = stuckInvoiceRows
      .map((invoice) => invoiceDetailsById.get(invoice.id))
      .filter(Boolean)

    const pendingJobs = (
      (pendingJobsResult.data as PendingJobRow[] | null) || []
    ).map((job) => {
      const payload = job.payload || {}
      const invoice =
        job.entity_type === 'invoice'
          ? invoiceDetailsById.get(job.entity_id)
          : null

      return {
        id: job.id,
        entity_type: job.entity_type,
        entity_id: job.entity_id,
        label:
          invoice?.label ||
          (typeof payload.display_name === 'string'
            ? payload.display_name
            : job.entity_type === 'customer'
              ? 'Customer sync'
              : 'Invoice sync'),
        customer_name:
          invoice?.customer_name ||
          (typeof payload.display_name === 'string'
            ? payload.display_name
            : null),
        appointment_date: invoice?.appointment_date ?? null,
        start_time: invoice?.start_time ?? null,
        total: invoice?.total ?? null,
        location: invoice?.location ?? null,
        created_at: job.created_at ?? null,
        updated_at: job.updated_at ?? null,
        url: invoice?.url ?? null,
      }
    })

    return NextResponse.json(
      {
        ...connectionStatus,
        pending: pendingResult.count || 0,
        failed: failedResult.count || 0,
        stuck: stuckInvoiceRows.length,
        pending_jobs: pendingJobs,
        stuck_invoices: stuckInvoices,
        last_synced_at: syncedResult.data?.updated_at || null,
      },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      },
    )
  } catch (error) {
    console.error('[quickbooks/status] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
