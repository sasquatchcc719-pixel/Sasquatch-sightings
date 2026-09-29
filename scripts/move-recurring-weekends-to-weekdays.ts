import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { findAppointmentConflict } from '@/lib/ops/availability-bundle'
import { moveRecurringDateToWeekday } from '@/lib/ops/recurring'

config({ path: resolve(process.cwd(), '.env.local') })

type Appointment = {
  id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  assigned_staff_user_id: string | null
  is_subcontracted: boolean
  recurring_template_id: string
}

type ReservedWindow = {
  appointmentId: string
  date: string
  startTime: string
  endTime: string
  staffUserId: string | null
}

function dateKeyInDenver(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + amount)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function nextWeekday(date: string): string {
  let candidate = date
  while ([0, 6].includes(new Date(`${candidate}T12:00:00`).getDay())) {
    candidate = addDays(candidate, 1)
  }
  return candidate
}

function timeOverlaps(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return startA < endB && startB < endA
}

function reservedConflict(
  appointment: Appointment,
  candidate: string,
  reserved: ReservedWindow[],
): ReservedWindow | null {
  return (
    reserved.find(
      (window) =>
        window.date === candidate &&
        (window.staffUserId === appointment.assigned_staff_user_id ||
          window.staffUserId === null ||
          appointment.assigned_staff_user_id === null) &&
        timeOverlaps(
          appointment.start_time,
          appointment.end_time,
          window.startTime,
          window.endTime,
        ),
    ) || null
  )
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase service credentials are missing from .env.local')
  }

  const apply = process.argv.includes('--apply')
  const fromDate = dateKeyInDenver()
  const supabase = createClient(url, key)
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(
      'id, appointment_date, start_time, end_time, status, assigned_staff_user_id, is_subcontracted, recurring_template_id',
    )
    .not('recurring_template_id', 'is', null)
    .gte('appointment_date', fromDate)
    .in('status', ['booked', 'confirmed'])
    .order('appointment_date')

  if (error) throw error

  const weekendAppointments = ((data || []) as Appointment[]).filter((row) =>
    [0, 6].includes(new Date(`${row.appointment_date}T12:00:00`).getDay()),
  )
  const reserved: ReservedWindow[] = []
  const results: Array<{
    id: string
    from: string
    to: string
    status: 'planned' | 'moved'
  }> = []

  for (const appointment of weekendAppointments) {
    let candidate = moveRecurringDateToWeekday(appointment.appointment_date)
    let found = false

    for (let attempt = 0; attempt < 15; attempt += 1) {
      candidate = nextWeekday(candidate)
      const reservedOverlap = appointment.is_subcontracted
        ? null
        : reservedConflict(appointment, candidate, reserved)
      const databaseOverlap = appointment.is_subcontracted
        ? null
        : await findAppointmentConflict(supabase, {
            date: candidate,
            startTime: appointment.start_time,
            endTime: appointment.end_time,
            excludeAppointmentId: appointment.id,
            staffUserId: appointment.assigned_staff_user_id || undefined,
          })

      if (!reservedOverlap && !databaseOverlap) {
        found = true
        break
      }
      candidate = addDays(candidate, 1)
    }

    if (!found) {
      throw new Error(
        `No open weekday found for ${appointment.id} after ${appointment.appointment_date}`,
      )
    }

    reserved.push({
      appointmentId: appointment.id,
      date: candidate,
      startTime: appointment.start_time,
      endTime: appointment.end_time,
      staffUserId: appointment.assigned_staff_user_id,
    })

    if (apply) {
      const { error: updateError } = await supabase
        .from('ops_appointments')
        .update({
          appointment_date: candidate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appointment.id)
      if (updateError) throw updateError

      const { error: eventError } = await supabase
        .from('ops_appointment_status_events')
        .insert({
          appointment_id: appointment.id,
          from_status: appointment.status,
          to_status: appointment.status,
          changed_by: null,
          notes: `Moved from ${appointment.appointment_date} to ${candidate}: recurring cleaning is scheduled on weekdays only.`,
        })
      if (eventError) throw eventError
    }

    results.push({
      id: appointment.id,
      from: appointment.appointment_date,
      to: candidate,
      status: apply ? 'moved' : 'planned',
    })
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        fromDate,
        count: results.length,
        results,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
