import Link from 'next/link'
import Image from 'next/image'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  ExternalLink,
  MapPin,
  Phone,
} from 'lucide-react'
import { AuthButton } from '@/components/auth-button'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { getAssignedTechAppointments } from '@/lib/tech/appointments'

type FieldPageProps = {
  searchParams?: Promise<{
    date?: string
  }>
}

function formatDateKey(date: Date): string {
  return date.toISOString().split('T')[0]
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function parseDate(value: string | undefined): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date()
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function formatDisplayDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

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

function addressLine(appointment: {
  address: {
    street1: string
    street2: string | null
    city: string
    state: string
    zipCode: string
  } | null
}): string {
  if (!appointment.address) return ''
  return [
    appointment.address.street1,
    appointment.address.street2,
    appointment.address.city,
    appointment.address.state,
    appointment.address.zipCode,
  ]
    .filter(Boolean)
    .join(', ')
}

export default async function FieldPage({ searchParams }: FieldPageProps) {
  const params = await searchParams
  const date = parseDate(params?.date)
  const dateKey = formatDateKey(date)
  const previousDate = formatDateKey(addDays(date, -1))
  const nextDate = formatDateKey(addDays(date, 1))

  const access = await requireAnyRole(['admin', 'owner', 'tech'])
  const supabase = createAdminClient()
  const staffUserId = access.staff?.id ?? access.id
  const appointments = await getAssignedTechAppointments(
    supabase,
    staffUserId,
    dateKey,
  )

  return (
    <main className="min-h-screen bg-slate-950 pb-8 text-slate-50">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <Link href="/field" className="flex items-center gap-2 font-semibold">
            <Image
              src="/vector6-no-background.svg"
              alt="Sasquatch"
              width={30}
              height={30}
              priority
            />
            <span>Field Mode</span>
          </Link>
          <AuthButton />
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <section className="rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 p-5 shadow-2xl shadow-emerald-950/30">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
            <CalendarDays className="h-4 w-4" />
            {formatDisplayDate(dateKey)}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Field Jobs</h1>
          <p className="mt-2 text-sm text-slate-300">
            Fast view for weak signal: address, call, maps, and job actions.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Link
              href={`/field?date=${previousDate}`}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium text-slate-100"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Link>
            <Link
              href="/field"
              className="inline-flex items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-100"
            >
              Today
            </Link>
            <Link
              href={`/field?date=${nextDate}`}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium text-slate-100"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        {appointments.length === 0 ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-8 text-center">
            <Clock className="mx-auto mb-3 h-8 w-8 text-slate-500" />
            <h2 className="font-semibold">No field jobs this day</h2>
            <p className="mt-1 text-sm text-slate-400">
              Assigned jobs will show here when they are on your schedule.
            </p>
          </section>
        ) : (
          <div className="space-y-3">
            {appointments.map((appointment) => {
              const address = addressLine(appointment)
              const mapsHref = address
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
                : null
              const appleMapsHref = address
                ? `https://maps.apple.com/?q=${encodeURIComponent(address)}`
                : null
              const total = appointment.hidePricing
                ? null
                : (appointment.invoice?.total ?? appointment.quotedTotal)

              return (
                <section
                  key={appointment.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-300">
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

                  {address ? (
                    <p className="mt-3 flex items-start gap-2 text-sm text-slate-300">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      {address}
                    </p>
                  ) : null}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {appointment.customerPhone ? (
                      <a
                        href={`tel:${appointment.customerPhone}`}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-semibold text-slate-100"
                      >
                        <Phone className="h-4 w-4" />
                        Call
                      </a>
                    ) : null}
                    {mapsHref ? (
                      <a
                        href={mapsHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-semibold text-slate-100"
                      >
                        <MapPin className="h-4 w-4" />
                        Google Maps
                      </a>
                    ) : null}
                    {appleMapsHref ? (
                      <a
                        href={appleMapsHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-semibold text-slate-100"
                      >
                        <MapPin className="h-4 w-4" />
                        Apple Maps
                      </a>
                    ) : null}
                    <Link
                      href={`/tech/jobs/${appointment.id}`}
                      className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950"
                    >
                      Open job
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </div>

                  {total != null ? (
                    <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
                      <DollarSign className="h-4 w-4" />
                      {Number(total || 0).toFixed(2)}
                    </p>
                  ) : null}
                </section>
              )
            })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/tech"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center text-sm font-medium text-slate-200"
          >
            Tech portal
          </Link>
          <Link
            href="/admin/operations"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center text-sm font-medium text-slate-200"
          >
            Full calendar
          </Link>
        </div>
      </div>
    </main>
  )
}
