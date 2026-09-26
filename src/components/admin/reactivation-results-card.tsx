'use client'

import {
  CalendarCheck,
  Mail,
  MousePointerClick,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

export type TemplateResult = {
  template_key: string | null
  sent: number
  tracked_sent: number
  first_sent_at: string | null
  customers_clicked: number
  clicked_bookings: number
  clicked_booking_value: number | string
  booked_30d: number
  booked_30d_value: number | string
}

type Relation<T> = T | T[] | null

export type RecentClick = {
  id: string
  customer_id: string | null
  template_key: string | null
  clicked_at: string
  ops_customers: Relation<{ full_name: string | null }>
  ops_appointments: Relation<{
    id: string
    status: string
    quoted_total: number | string | null
    appointment_date: string | null
  }>
}

export type ReactivationResults = {
  tracking_since: string | null
  templates: TemplateResult[]
  recent_clicks: RecentClick[]
}

function asList<T>(value: Relation<T> | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function money(value: number) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function percent(part: number, whole: number) {
  if (!whole) return '—'
  return `${((part / whole) * 100).toFixed(1)}%`
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function ReactivationResultsCard({
  results,
  templateLabels,
}: {
  results: ReactivationResults | undefined
  templateLabels: Map<string, string>
}) {
  const rows = [...(results?.templates || [])].sort(
    (a, b) => Number(b.sent) - Number(a.sent),
  )
  const sum = (pick: (row: TemplateResult) => number | string) =>
    rows.reduce((total, row) => total + Number(pick(row) || 0), 0)

  const totals = {
    sent: sum((r) => r.sent),
    trackedSent: sum((r) => r.tracked_sent),
    clicked: sum((r) => r.customers_clicked),
    clickedBookings: sum((r) => r.clicked_bookings),
    clickedValue: sum((r) => r.clicked_booking_value),
    booked30d: sum((r) => r.booked_30d),
    booked30dValue: sum((r) => r.booked_30d_value),
  }
  const label = (key: string | null) =>
    (key && templateLabels.get(key)) || key || 'Unknown template'

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Results</h3>
        <span className="text-xs text-white/45">
          {results?.tracking_since
            ? `Click tracking since ${shortDate(results.tracking_since)}`
            : 'Click tracking starts with the next send'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <Mail className="mb-2 h-4 w-4 text-emerald-300" />
          <div className="text-2xl font-semibold">{totals.sent}</div>
          <div className="text-xs text-white/45">
            Emails sent ({totals.trackedSent} with click tracking)
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <MousePointerClick className="mb-2 h-4 w-4 text-cyan-300" />
          <div className="text-2xl font-semibold">{totals.clicked}</div>
          <div className="text-xs text-white/45">
            Clicked BOOK ONLINE ({percent(totals.clicked, totals.trackedSent)}{' '}
            of tracked sends)
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <CalendarCheck className="mb-2 h-4 w-4 text-amber-300" />
          <div className="text-2xl font-semibold">
            {totals.clickedBookings}
            <span className="ml-2 text-sm font-normal text-white/60">
              {money(totals.clickedValue)}
            </span>
          </div>
          <div className="text-xs text-white/45">
            Booked within 30 days of clicking
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <TrendingUp className="mb-2 h-4 w-4 text-violet-300" />
          <div className="text-2xl font-semibold">
            {totals.booked30d}
            <span className="ml-2 text-sm font-normal text-white/60">
              {money(totals.booked30dValue)}
            </span>
          </div>
          <div className="text-xs text-white/45">
            Booked within 30 days of any email (includes some who would have
            come back anyway)
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-white/45">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 font-normal">Template</th>
                <th className="py-2 pr-3 text-right font-normal">Sent</th>
                <th className="py-2 pr-3 text-right font-normal">Clicked</th>
                <th className="py-2 pr-3 text-right font-normal">
                  Booked after click
                </th>
                <th className="py-2 text-right font-normal">
                  Booked within 30d
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.template_key || 'unknown'}
                  className="border-b border-white/5"
                >
                  <td className="py-2 pr-3">{label(row.template_key)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.sent}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.customers_clicked}
                    <span className="ml-1 text-xs text-white/40">
                      {percent(
                        Number(row.customers_clicked),
                        Number(row.tracked_sent),
                      )}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.clicked_bookings}
                    <span className="ml-1 text-xs text-white/40">
                      {money(Number(row.clicked_booking_value || 0))}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {row.booked_30d}
                    <span className="ml-1 text-xs text-white/40">
                      {money(Number(row.booked_30d_value || 0))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5">
        <h4 className="text-sm font-medium text-white/70">Recent clicks</h4>
        {(results?.recent_clicks || []).length === 0 ? (
          <p className="mt-2 text-sm text-white/45">
            No clicks yet. Emails sent before tracking went live don&apos;t have
            a tracked link.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5 text-sm">
            {(results?.recent_clicks || []).map((click) => {
              const customer = asList(click.ops_customers)[0]
              const booking = asList(click.ops_appointments).find(
                (appt) => appt.status !== 'cancelled',
              )
              return (
                <li
                  key={click.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div>
                    <div>{customer?.full_name || 'Unknown customer'}</div>
                    <div className="text-xs text-white/45">
                      {label(click.template_key)} ·{' '}
                      {shortDate(click.clicked_at)}
                    </div>
                  </div>
                  {booking ? (
                    <Badge>
                      Booked
                      {booking.quoted_total
                        ? ` · ${money(Number(booking.quoted_total))}`
                        : ''}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Not booked yet</Badge>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
