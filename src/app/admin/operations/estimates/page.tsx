import Link from 'next/link'
import { Plus, Ruler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

type Estimate = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  estimate_status: string | null
  converted_appointment_id: string | null
  quoted_total: number | null
  ops_customers: {
    id: string
    full_name: string | null
    business_name: string | null
  } | null
  ops_service_addresses: {
    street_1: string
    city: string
    state: string
  } | null
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  sent: 'bg-sky-100 text-sky-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-rose-100 text-rose-800',
  converted: 'bg-violet-100 text-violet-800',
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

async function loadEstimates(): Promise<Estimate[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(
      `
        id,
        appointment_date,
        start_time,
        end_time,
        estimate_status,
        converted_appointment_id,
        quoted_total,
        ops_customers!ops_appointments_customer_id_fkey (
          id,
          full_name,
          business_name
        ),
        ops_service_addresses (
          street_1,
          city,
          state
        )
      `,
    )
    .eq('kind', 'estimate')
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[estimates/page] load error:', error)
    return []
  }

  return (data as unknown as Estimate[]) || []
}

export default async function EstimatesListPage() {
  await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing', 'tech'])
  const estimates = await loadEstimates()

  const openCount = estimates.filter(
    (e) =>
      e.estimate_status !== 'converted' && e.estimate_status !== 'declined',
  ).length

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Ruler className="text-muted-foreground h-5 w-5" />
            <h1 className="text-2xl font-bold">Estimates</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Measuring visits and outstanding quotes. {openCount} open.
          </p>
        </div>
        <Button asChild className="gap-2">
          <Link href="/admin/operations/estimates/new">
            <Plus className="h-4 w-4" />
            New estimate
          </Link>
        </Button>
      </div>

      {estimates.length === 0 ? (
        <Card className="p-10 text-center">
          <Ruler className="text-muted-foreground mx-auto h-8 w-8" />
          <p className="mt-3 font-medium">No estimates yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Book a measuring visit and track it here.
          </p>
          <Button asChild className="mt-4 gap-2">
            <Link href="/admin/operations/estimates/new">
              <Plus className="h-4 w-4" />
              Create your first estimate
            </Link>
          </Button>
        </Card>
      ) : (
        <Card className="divide-border/60 divide-y p-0">
          {estimates.map((estimate) => {
            const customer = estimate.ops_customers
            const addr = estimate.ops_service_addresses
            const status = estimate.estimate_status || 'draft'
            return (
              <Link
                key={estimate.id}
                href={`/admin/operations/estimates/${estimate.id}`}
                className="hover:bg-muted/40 flex flex-col gap-1 p-4 transition-colors md:flex-row md:items-center md:justify-between md:gap-6"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {customer?.business_name ||
                      customer?.full_name ||
                      'Unknown customer'}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {addr
                      ? `${addr.street_1}, ${addr.city}, ${addr.state}`
                      : 'No address'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm md:gap-4">
                  <span className="text-muted-foreground tabular-nums">
                    {formatDate(estimate.appointment_date)} ·{' '}
                    {estimate.start_time.slice(0, 5)}
                  </span>
                  <span className="tabular-nums">
                    ${Number(estimate.quoted_total || 0).toFixed(2)}
                  </span>
                  <Badge
                    className={
                      STATUS_STYLE[status] || 'bg-slate-100 text-slate-700'
                    }
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Badge>
                </div>
              </Link>
            )
          })}
        </Card>
      )}
    </div>
  )
}
