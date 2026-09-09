import Link from 'next/link'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Truck,
} from 'lucide-react'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { getAssignedTechAppointments } from '@/lib/tech/appointments'
import { TechDaySchedule } from '@/components/tech/tech-day-schedule'
import { getMountainDateKey, shiftDateKey } from '@/lib/tech/day-schedule'

type TechHomePageProps = {
  searchParams?: Promise<{ date?: string }>
}

function formatDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function selectedDateKey(value: string | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return getMountainDateKey()
}

export default async function TechHomePage({
  searchParams,
}: TechHomePageProps) {
  const params = await searchParams
  const access = await requireAnyRole(['admin', 'owner', 'tech'])
  const supabase = createAdminClient()
  const today = getMountainDateKey()
  const dateKey = selectedDateKey(params?.date)
  const staffUserId = access.staff?.id ?? access.id
  const appointments = await getAssignedTechAppointments(
    supabase,
    staffUserId,
    dateKey,
  )

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 p-5 shadow-2xl shadow-emerald-950/30">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
          <CalendarDays className="h-4 w-4" />
          {formatDate(dateKey)}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Daily Jobs</h1>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Link
            href={`/tech?date=${shiftDateKey(dateKey, -1)}`}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Link>
          <Link
            href="/tech"
            className="inline-flex items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-sm font-medium text-emerald-100"
          >
            {dateKey === today ? 'Today' : 'Go to today'}
          </Link>
          <Link
            href={`/tech?date=${shiftDateKey(dateKey, 1)}`}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-medium"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <Link
        href="/tech/vehicle-help"
        className="flex items-center gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-4 transition hover:bg-amber-300/10"
      >
        <Truck className="h-6 w-6 shrink-0 text-amber-200" />
        <span className="flex-1">
          <span className="block font-semibold text-amber-100">
            Vehicle Help
          </span>
          <span className="mt-1 block text-sm text-slate-300">
            Roadside help, towing, repairs, and schedule changes
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-amber-200" />
      </Link>

      {appointments.length === 0 ? (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <Clock className="mx-auto mb-3 h-8 w-8 text-slate-500" />
          <h2 className="font-semibold">No assigned jobs today</h2>
          <p className="mt-1 text-sm text-slate-400">
            Assigned jobs will show up here once dispatch puts them on your day.
          </p>
        </section>
      ) : (
        <TechDaySchedule appointments={appointments} />
      )}
    </div>
  )
}
