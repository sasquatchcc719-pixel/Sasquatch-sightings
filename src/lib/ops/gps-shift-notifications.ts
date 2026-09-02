import type { StaffUserData } from '@/lib/auth'
import { sendTelegramNotification } from '@/lib/telegram'

const TARGET_STAFF_NAME = 'david'
const TIME_ZONE = 'America/Denver'

type ShiftSnapshot = {
  id: string
  started_at?: string | null
  ended_at?: string | null
  break_started_at?: string | null
  break_minutes?: number | string | null
}

type PayrollSnapshot = {
  payable_minutes?: number | string | null
  break_minutes?: number | string | null
}

type ShiftEvent =
  | 'clock_in'
  | 'clock_out'
  | 'break_start'
  | 'break_end'
  | 'undo_clock_out'

export async function notifyDavidShiftEvent(params: {
  staff: StaffUserData | null
  event: ShiftEvent
  shift: ShiftSnapshot
  payrollEntry?: PayrollSnapshot | null
}): Promise<void> {
  const { staff, event, shift, payrollEntry } = params
  if (!shouldNotifyForStaff(staff)) return

  const staffName = staff?.display_name || 'David'
  const breakMinutes = Number(
    payrollEntry?.break_minutes ?? shift.break_minutes ?? 0,
  )
  const payableMinutes = Number(payrollEntry?.payable_minutes ?? 0)

  const lines = [
    `David time clock update`,
    `${staffName} ${eventLabel(event)}.`,
    `Time: ${formatShiftTime(eventTime(event, shift))}`,
  ]

  if (event === 'clock_out') {
    lines.push(`Shift started: ${formatShiftTime(shift.started_at)}`)
    lines.push(`Break time: ${formatMinutes(breakMinutes)}`)
    if (payableMinutes > 0) {
      lines.push(`Payable time: ${formatMinutes(payableMinutes)}`)
    }
  }

  if (event === 'break_end') {
    lines.push(`Total break time today: ${formatMinutes(breakMinutes)}`)
  }

  await sendTelegramNotification(lines.join('\n'))
}

function shouldNotifyForStaff(staff: StaffUserData | null): boolean {
  return staff?.display_name.toLowerCase().includes(TARGET_STAFF_NAME) ?? false
}

function eventLabel(event: ShiftEvent): string {
  switch (event) {
    case 'clock_in':
      return 'clocked in'
    case 'clock_out':
      return 'clocked out'
    case 'break_start':
      return 'started break'
    case 'break_end':
      return 'ended break'
    case 'undo_clock_out':
      return 'undid a clock out (back on the clock)'
  }
}

function eventTime(event: ShiftEvent, shift: ShiftSnapshot): string | null {
  switch (event) {
    case 'clock_in':
      return shift.started_at ?? null
    case 'clock_out':
      return shift.ended_at ?? null
    case 'break_start':
      return shift.break_started_at ?? null
    case 'break_end':
    case 'undo_clock_out':
      return new Date().toISOString()
  }
}

function formatShiftTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unknown'

  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

function formatMinutes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0m'

  const minutes = Math.round(value)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours === 0) return `${remainingMinutes}m`
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}
