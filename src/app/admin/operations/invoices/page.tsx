import Link from 'next/link'
import { AlertTriangle, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Invoice = {
  id: string
  invoice_number: number | null
  status: string
  payment_status: string
  payment_method: string | null
  sync_status: string
  quickbooks_invoice_id: string | null
  total: number
  created_at: string
  ops_appointments: {
    appointment_date: string
    status: string
    ops_customers: {
      full_name: string | null
      business_name: string | null
    } | null
    ops_service_addresses: {
      street_1: string
      city: string
      state: string
    } | null
  } | null
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  ready: 'bg-sky-100 text-sky-800',
  sent: 'bg-violet-100 text-violet-800',
  paid: 'bg-emerald-100 text-emerald-800',
  void: 'bg-rose-100 text-rose-800',
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(
    Date.UTC(year, (month || 1) - 1, day || 1),
  ).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

async function loadInvoices(): Promise<Invoice[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('ops_invoices')
    .select(
      `
        id,
        invoice_number,
        status,
        payment_status,
        payment_method,
        sync_status,
        quickbooks_invoice_id,
        total,
        created_at,
        ops_appointments!inner (
          appointment_date,
          status,
          ops_customers!ops_appointments_customer_id_fkey (
            full_name,
            business_name
          ),
          ops_service_addresses (
            street_1,
            city,
            state
          )
        )
      `,
    )
    .order('created_at', { ascending: false })
    .limit(300)

  if (error) {
    console.error('[invoices/page] load error:', error)
    return []
  }

  return (data as unknown as Invoice[]) || []
}

export default async function InvoicesPage() {
  await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing', 'tech'])
  const invoices = await loadInvoices()
  const missingQuickBooks = invoices.filter(
    (invoice) =>
      invoice.status !== 'draft' &&
      invoice.payment_method !== 'cash' &&
      invoice.sync_status !== 'held' &&
      invoice.sync_status !== 'synced' &&
      !invoice.quickbooks_invoice_id,
  ).length

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <div className="flex items-center gap-2">
          <FileText className="text-muted-foreground h-5 w-5" />
          <h1 className="text-2xl font-bold">Invoices</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Open any invoice directly. Showing the newest {invoices.length}.
        </p>
      </div>

      {missingQuickBooks > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {missingQuickBooks} completed or paid{' '}
            {missingQuickBooks === 1 ? 'invoice is' : 'invoices are'} still
            waiting for QuickBooks.
          </span>
        </div>
      ) : null}

      {invoices.length === 0 ? (
        <Card className="p-10 text-center">
          <FileText className="text-muted-foreground mx-auto h-8 w-8" />
          <p className="mt-3 font-medium">No invoices found</p>
        </Card>
      ) : (
        <Card className="divide-border/60 divide-y p-0">
          {invoices.map((invoice) => {
            const appointment = invoice.ops_appointments
            const customer = appointment?.ops_customers
            const address = appointment?.ops_service_addresses
            const status = invoice.status || 'draft'
            const waitingForQuickBooks =
              status !== 'draft' &&
              invoice.payment_method !== 'cash' &&
              invoice.sync_status !== 'held' &&
              invoice.sync_status !== 'synced' &&
              !invoice.quickbooks_invoice_id

            return (
              <Link
                key={invoice.id}
                href={`/admin/operations/invoices/${invoice.id}`}
                className="hover:bg-muted/40 flex flex-col gap-2 p-4 transition-colors md:flex-row md:items-center md:justify-between md:gap-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">
                      {customer?.business_name ||
                        customer?.full_name ||
                        'Unknown customer'}
                    </p>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      #{invoice.invoice_number || invoice.id.slice(0, 8)}
                    </span>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {address
                      ? `${address.street_1}, ${address.city}, ${address.state}`
                      : 'No service address'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm md:justify-end md:gap-4">
                  <span className="text-muted-foreground tabular-nums">
                    {appointment?.appointment_date
                      ? formatDate(appointment.appointment_date)
                      : 'No job date'}
                  </span>
                  <span className="font-medium tabular-nums">
                    ${Number(invoice.total || 0).toFixed(2)}
                  </span>
                  <Badge
                    className={
                      STATUS_STYLE[status] || 'bg-slate-100 text-slate-700'
                    }
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Badge>
                  {waitingForQuickBooks ? (
                    <Badge className="bg-amber-100 text-amber-900">
                      QB waiting
                    </Badge>
                  ) : invoice.quickbooks_invoice_id ? (
                    <Badge className="bg-emerald-100 text-emerald-800">
                      QB synced
                    </Badge>
                  ) : null}
                </div>
              </Link>
            )
          })}
        </Card>
      )}
    </div>
  )
}
