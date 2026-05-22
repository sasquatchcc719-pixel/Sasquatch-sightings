import Link from 'next/link'
import {
  CalendarDays,
  Clock,
  DollarSign,
  MapPin,
  ShieldAlert,
} from 'lucide-react'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { getAssignedTechAppointments } from '@/lib/tech/appointments'

function formatTime(value: string | null): string {
  if (!value) return 'Time TBD'
  const [hour, minute] = value.split(':')
  const date = new Date()
  date.setHours(Number(hour), Number(minute), 0, 0)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

export default async function TechHomePage() {
  const access = await requireAnyRole(['admin', 'owner', 'tech'])
  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const staffUserId = access.staff?.id ?? access.id
  const appointments = await getAssignedTechAppointments(
    supabase,
    staffUserId,
    today,
  )

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 p-5 shadow-2xl shadow-emerald-950/30">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
          <CalendarDays className="h-4 w-4" />
          {formatDate(today)}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Today&apos;s Jobs
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Assigned work only. Recovery Village pricing is hidden here by design.
        </p>
      </section>

      {appointments.length === 0 ? (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <Clock className="mx-auto mb-3 h-8 w-8 text-slate-500" />
          <h2 className="font-semibold">No assigned jobs today</h2>
          <p className="mt-1 text-sm text-slate-400">
            Assigned jobs will show up here once dispatch puts them on your day.
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          {appointments.map((appointment) => {
            const address = appointment.address
              ? `${appointment.address.street1}, ${appointment.address.city}`
              : 'No address'
            return (
              <Link
                key={appointment.id}
                href={`/tech/jobs/${appointment.id}`}
                className="block rounded-2xl border border-white/10 bg-white/[0.06] p-4 transition hover:border-emerald-400/40 hover:bg-white/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-emerald-300">
                      {formatTime(appointment.startTime)}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold">
                      {appointment.businessName || appointment.customerName}
                    </h2>
                    {appointment.businessName ? (
                      <p className="text-sm text-slate-400">
                        {appointment.customerName}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 capitalize">
                    {appointment.status.replaceAll('_', ' ')}
                  </span>
                </div>

                <p className="mt-3 flex items-start gap-2 text-sm text-slate-300">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  {address}
                </p>

                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                  {appointment.hidePricing ? (
                    <p className="flex items-center gap-1.5 text-sm text-amber-300">
                      <ShieldAlert className="h-4 w-4" />
                      Price hidden
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
                      <DollarSign className="h-4 w-4" />
                      {Number(
                        appointment.invoice?.total ??
                          appointment.quotedTotal ??
                          0,
                      ).toFixed(2)}
                    </p>
                  )}
                  <span className="text-sm text-slate-400">Open</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
