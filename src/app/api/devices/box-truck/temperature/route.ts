import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  BOX_TRUCK_NAME,
  PROBE_STALE_MS,
  temperatureAlarm,
} from '@/lib/truck-temperature'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: Request) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
  if (!token)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdminClient()
  const { data: credential, error: credentialError } = await db
    .from('fleet_temperature_display_tokens')
    .select('id')
    .eq('token_hash', createHash('sha256').update(token).digest('hex'))
    .eq('enabled', true)
    .maybeSingle()
  if (credentialError)
    return NextResponse.json(
      { error: 'Temperature unavailable' },
      { status: 503 },
    )
  if (!credential)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await db
    .from('fleet_trackers')
    .select(
      'probe_temperature_c,probe_received_at,temperature_low_f,temperature_high_f',
    )
    .eq('name', BOX_TRUCK_NAME)
    .eq('enabled', true)
    .maybeSingle()
  if (error || !data)
    return NextResponse.json(
      { error: 'Temperature unavailable' },
      { status: 503 },
    )

  const temperatureF =
    data.probe_temperature_c == null
      ? null
      : Math.round((data.probe_temperature_c * 1.8 + 32) * 10) / 10
  const fresh = Boolean(
    data.probe_received_at &&
    temperatureF != null &&
    Date.now() - Date.parse(data.probe_received_at) <= PROBE_STALE_MS,
  )
  return NextResponse.json(
    {
      vehicle: BOX_TRUCK_NAME,
      temperatureF,
      receivedAt: data.probe_received_at,
      lowF: data.temperature_low_f,
      highF: data.temperature_high_f,
      fresh,
      alarm: fresh
        ? temperatureAlarm(
            temperatureF,
            data.temperature_low_f,
            data.temperature_high_f,
          )
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
