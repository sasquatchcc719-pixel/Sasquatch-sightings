'use client'

import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'

export type LeadSourceRevenueRow = {
  lead_source_key: string
  lead_source: string
  booking_count: number
  completed_count: number
  total_revenue: number
  avg_ticket: number
  percentage: number
}

type JobDetail = {
  id: string
  appointment_date: string
  status: string
  kind: string | null
  revenue: number
  inherited: boolean
  is_return: boolean
}

type CustomerDetail = {
  customer_id: string | null
  customer_name: string
  job_count: number
  completed_count: number
  total_revenue: number
  jobs: JobDetail[]
}

type SourceDetails = {
  lead_source_key: string
  lead_source: string
  customers: CustomerDetail[]
  job_count: number
  completed_count: number
  total_revenue: number
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function moneyExact(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n)
}

export function LeadSourceRevenuePanel({
  sources,
  startDate,
  endDate,
  yearLabel,
}: {
  sources: LeadSourceRevenueRow[]
  startDate: string
  endDate: string
  yearLabel: string | number
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [detailsByKey, setDetailsByKey] = useState<
    Record<string, SourceDetails>
  >({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({})
  const [openCustomers, setOpenCustomers] = useState<Record<string, boolean>>(
    {},
  )

  const maxRev = Math.max(...sources.map((s) => s.total_revenue), 1)

  const toggleSource = async (sourceKey: string) => {
    if (openKey === sourceKey) {
      setOpenKey(null)
      return
    }
    setOpenKey(sourceKey)
    if (detailsByKey[sourceKey] || loadingKey === sourceKey) return

    setLoadingKey(sourceKey)
    setErrorByKey((current) => {
      const next = { ...current }
      delete next[sourceKey]
      return next
    })
    try {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        source_key: sourceKey,
      })
      const res = await fetch(`/api/admin/stats/lead-sources?${params}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Failed to load jobs for this source')
      const json = (await res.json()) as SourceDetails
      setDetailsByKey((current) => ({ ...current, [sourceKey]: json }))
    } catch (error) {
      setErrorByKey((current) => ({
        ...current,
        [sourceKey]:
          error instanceof Error ? error.message : 'Failed to load details',
      }))
    } finally {
      setLoadingKey(null)
    }
  }

  const toggleCustomer = (sourceKey: string, customerKey: string) => {
    const id = `${sourceKey}:${customerKey}`
    setOpenCustomers((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <div className="mb-8">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-gradient-blue text-xl font-semibold tracking-tight">
          Revenue by Lead Source — {yearLabel}
        </h2>
        <a
          href="/admin/stats/lead-sources"
          className="text-xs text-green-600 hover:text-green-700 hover:underline"
        >
          View Detailed Analytics →
        </a>
      </div>
      <p className="text-muted-foreground mb-4 max-w-3xl text-sm leading-relaxed">
        Where the money comes from, not just the job count — click a row to see
        the customers and jobs behind it.
      </p>
      <Card className="border-border/60 bg-card/80 p-4 backdrop-blur">
        <div className="space-y-1">
          {sources.map((s) => {
            const isOpen = openKey === s.lead_source_key
            const details = detailsByKey[s.lead_source_key]
            const loading = loadingKey === s.lead_source_key
            const error = errorByKey[s.lead_source_key]
            return (
              <div key={s.lead_source_key} className="rounded-lg">
                <button
                  type="button"
                  onClick={() => void toggleSource(s.lead_source_key)}
                  className="hover:bg-muted/40 flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition-colors"
                  aria-expanded={isOpen}
                >
                  <ChevronDown
                    className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform ${
                      isOpen ? 'rotate-0' : '-rotate-90'
                    }`}
                  />
                  <div className="w-32 shrink-0 truncate text-sm font-medium">
                    {s.lead_source}
                  </div>
                  <div className="bg-muted h-4 flex-1 overflow-hidden rounded-full">
                    <div
                      className="flex h-4 items-center rounded-full bg-blue-500/70"
                      style={{
                        width: `${Math.max((s.total_revenue / maxRev) * 100, 2)}%`,
                      }}
                    />
                  </div>
                  <div className="w-20 shrink-0 text-right text-sm font-semibold">
                    {money(s.total_revenue)}
                  </div>
                  <div className="text-muted-foreground w-28 shrink-0 text-right text-xs">
                    {s.booking_count} jobs · {money(s.avg_ticket)} avg
                  </div>
                </button>

                {isOpen ? (
                  <div className="border-border/50 bg-background/40 mb-2 ml-5 rounded-lg border p-3">
                    {loading ? (
                      <div className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading customers…
                      </div>
                    ) : null}
                    {error ? (
                      <p className="text-sm text-red-400">{error}</p>
                    ) : null}
                    {details && !loading ? (
                      details.customers.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          No jobs in this range.
                        </p>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-muted-foreground mb-2 text-xs">
                            {details.customers.length} customers ·{' '}
                            {details.completed_count} completed ·{' '}
                            {moneyExact(details.total_revenue)}
                          </p>
                          {details.customers.map((customer) => {
                            const customerKey =
                              customer.customer_id || customer.customer_name
                            const customerOpen =
                              openCustomers[
                                `${s.lead_source_key}:${customerKey}`
                              ] ?? false
                            return (
                              <div key={customerKey}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleCustomer(
                                      s.lead_source_key,
                                      customerKey,
                                    )
                                  }
                                  className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                                >
                                  <ChevronDown
                                    className={`text-muted-foreground h-3.5 w-3.5 shrink-0 transition-transform ${
                                      customerOpen ? 'rotate-0' : '-rotate-90'
                                    }`}
                                  />
                                  <span className="min-w-0 flex-1 truncate font-medium">
                                    {customer.customer_name}
                                  </span>
                                  <span className="text-muted-foreground shrink-0 text-xs">
                                    {customer.job_count} job
                                    {customer.job_count === 1 ? '' : 's'}
                                  </span>
                                  <span className="w-20 shrink-0 text-right text-sm font-semibold">
                                    {moneyExact(customer.total_revenue)}
                                  </span>
                                </button>
                                {customerOpen ? (
                                  <div className="border-border/40 ml-6 space-y-1 border-l pl-3">
                                    {customer.jobs.map((job) => (
                                      <div
                                        key={job.id}
                                        className="text-muted-foreground flex items-center gap-2 py-1 text-xs"
                                      >
                                        <span className="w-24 shrink-0">
                                          {job.appointment_date}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate capitalize">
                                          {job.status}
                                          {job.kind === 'restoration'
                                            ? ' · restoration'
                                            : ''}
                                          {job.inherited ? ' · inherited' : ''}
                                          {job.is_return && !job.inherited
                                            ? ' · return'
                                            : ''}
                                        </span>
                                        <span className="text-foreground w-20 shrink-0 text-right font-medium">
                                          {job.status === 'completed'
                                            ? moneyExact(job.revenue)
                                            : '—'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
