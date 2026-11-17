import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'
import { PROBE_STALE_MS, temperatureAlarmState } from '@/lib/truck-temperature'

export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('fleet_trackers')
    .select(
      'id,name,probe_temperature_c,probe_received_at,temperature_low_f,temperature_high_f,temperature_alarm_sent',
    )
    .eq('enabled', true)
    .gte(
      'probe_received_at',
      new Date(Date.now() - PROBE_STALE_MS).toISOString(),
    )
    .or('temperature_low_f.not.is.null,temperature_high_f.not.is.null')
  if (error)
    return NextResponse.json(
      { error: 'Unable to check alarms' },
      { status: 503 },
    )

  let failed = 0
  for (const tracker of data ?? []) {
    if (tracker.probe_temperature_c == null) continue
    const temperatureF = tracker.probe_temperature_c * 1.8 + 32
    const previousAlarm = tracker.temperature_alarm_sent as
      | 'low'
      | 'high'
      | null
    const alarm = temperatureAlarmState(
      temperatureF,
      tracker.temperature_low_f,
      tracker.temperature_high_f,
      previousAlarm,
    )
    if (alarm === previousAlarm) continue

    const update = db
      .from('fleet_trackers')
      .update({ temperature_alarm_sent: alarm })
      .eq('id', tracker.id)
      .eq('enabled', true)
      .eq('probe_received_at', tracker.probe_received_at)
    for (const field of [
      'temperature_alarm_sent',
      'temperature_low_f',
      'temperature_high_f',
    ] as const) {
      if (tracker[field] == null) update.is(field, null)
      else update.eq(field, tracker[field])
    }
    const claim = await update.select('id').maybeSingle()
    if (claim.error) {
      failed++
      continue
    }
    if (!claim.data) continue

    const recovered = Boolean(previousAlarm && !alarm)
    const threshold = alarm
      ? alarm === 'low'
        ? tracker.temperature_low_f
        : tracker.temperature_high_f
      : previousAlarm === 'low'
        ? tracker.temperature_low_f
        : tracker.temperature_high_f
    const sent = await sendTelegramNotification(
      recovered
        ? `${tracker.name} temperature recovered: ${temperatureF.toFixed(1)}°F (clear of ${previousAlarm} limit ${threshold}°F).\nhttps://sightings.sasquatchcarpet.com/admin/operations`
        : `${tracker.name} temperature alarm: ${temperatureF.toFixed(1)}°F (${alarm} limit ${threshold}°F).\nhttps://sightings.sasquatchcarpet.com/admin/operations`,
      { disablePreview: true },
    )
    if (!sent) {
      failed++
      const rollback = db
        .from('fleet_trackers')
        .update({ temperature_alarm_sent: previousAlarm })
        .eq('id', tracker.id)
      if (alarm == null) rollback.is('temperature_alarm_sent', null)
      else rollback.eq('temperature_alarm_sent', alarm)
      await rollback
    }
  }

  return NextResponse.json(
    { ok: failed === 0, failed },
    { status: failed ? 503 : 200 },
  )
}
