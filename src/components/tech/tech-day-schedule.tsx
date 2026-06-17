import Link from 'next/link'
import { DollarSign, MapPin } from 'lucide-react'
import type { TechAppointment } from '@/lib/tech/appointments'
import {
  getTechAppointmentPlacement,
  TECH_DAY_GRID_HEIGHT,
  TECH_DAY_HOURS,
  TECH_DAY_HOUR_HEIGHT,
} from '@/lib/tech/day-schedule'

function formatTime(value: string | null): string {
  if (!value) return 'Time TBD'
  const [hour, minute] = value.split(':').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)))
}

function formatHour(hour: number): string {
  if (hour === 12) return '12pm'
  return hour > 12 ? `${hour - 12}pm` : `${hour}am`
}

function appointmentTone(status: string): string {
  if (status === 'completed') {
    return 'border-slate-400 bg-slate-200 text-slate-700'
  }
  if (status === 'in_progress') {
    return 'border-amber-400 bg-amber-100 text-slate-900'
  }
  return 'border-emerald-400 bg-emerald-100 text-slate-900'
}

function addressLabel(appointment: TechAppointment): string | null {
  if (!appointment.address) return null
  return [
    appointment.address.street1,
    appointment.address.city,
    appointment.address.state,
  ]
    .filter(Boolean)
    .join(', ')
}

function JobContent({ appointment }: { appointment: TechAppointment }) {
  const address = addressLabel(appointment)
  const serviceNames = appointment.lineItems.map((item) => item.name).join(', ')
  const amount = appointment.invoice?.total ?? appointment.quotedTotal ?? 0

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 truncate font-semibold">
          {appointment.businessName || appointment.customerName}
        </h2>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold capitalize">
          {appointment.status.replaceAll('_', ' ')}
        </span>
      </div>
      {appointment.businessName ? (
        <p className="truncate text-[11px] text-slate-600">
          {appointment.customerName}
        </p>
      ) : null}
      <p className="mt-0.5 text-[11px] font-medium text-slate-700">
        {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
      </p>
      {address ? (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-slate-600">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-1">{address}</span>
        </p>
      ) : null}
      {serviceNames ? (
        <p className="mt-1 line-clamp-2 text-xs text-slate-800">
          {serviceNames}
        </p>
      ) : null}
      <div className="mt-auto flex items-center justify-between pt-1 text-[11px] font-semibold">
        {appointment.hidePricing ? (
          <span />
        ) : (
          <span className="flex items-center gap-0.5">
            <DollarSign className="h-3 w-3" />
            {Number(amount).toFixed(2)}
          </span>
        )}
        <span>Open job</span>
      </div>
    </>
  )
}

export function TechDaySchedule({
  appointments,
}: {
  appointments: TechAppointment[]
}) {
  const unscheduled = appointments.filter(
    (appointment) =>
      getTechAppointmentPlacement(
        appointment.startTime,
        appointment.endTime,
      ) === null,
  )

  return (
    <div className="space-y-3">
      {unscheduled.map((appointment) => (
        <Link
          key={appointment.id}
          href={`/tech/jobs/${appointment.id}`}
          className={`flex min-h-32 flex-col rounded-2xl border p-3 shadow-sm ${appointmentTone(appointment.status)}`}
        >
          <JobContent appointment={appointment} />
        </Link>
      ))}

      <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
        <div className="grid grid-cols-[58px_1fr] border-b border-slate-200 bg-slate-100">
          <div className="border-r border-slate-200" />
          <div className="px-3 py-2 text-sm font-semibold text-slate-700">
            My schedule
          </div>
        </div>
        <div
          className="grid grid-cols-[58px_1fr]"
          style={{ height: TECH_DAY_GRID_HEIGHT }}
        >
          <div className="border-r border-slate-200 bg-slate-50">
            {TECH_DAY_HOURS.map((hour) => (
              <div
                key={hour}
                className="border-b border-slate-200 px-2 pt-2 text-right text-[11px] text-slate-500"
                style={{ height: TECH_DAY_HOUR_HEIGHT }}
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>
          <div className="relative bg-white">
            {TECH_DAY_HOURS.map((hour) => (
              <div
                key={hour}
                className="border-b border-slate-200"
                style={{ height: TECH_DAY_HOUR_HEIGHT }}
              />
            ))}
            {appointments.map((appointment) => {
              const placement = getTechAppointmentPlacement(
                appointment.startTime,
                appointment.endTime,
              )
              if (!placement) return null

              return (
                <Link
                  key={appointment.id}
                  href={`/tech/jobs/${appointment.id}`}
                  className={`absolute right-2 left-2 flex flex-col overflow-hidden rounded-2xl border p-2 text-xs shadow-sm transition hover:brightness-95 ${appointmentTone(appointment.status)}`}
                  style={{
                    top: placement.top + 5,
                    height: Math.max(placement.height - 10, 52),
                  }}
                >
                  <JobContent appointment={appointment} />
                </Link>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
