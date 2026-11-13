import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import {
  BOX_TRUCK_NAME,
  TEMPERATURE_HISTORY_RANGES,
} from '@/lib/truck-temperature'
import { createAdminClient } from '@/supabase/server'

const columns =
  'id,probe_temperature_c,probe_received_at,temperature_low_f,temperature_high_f'
const limit = z.number().min(-67).max(257).nullable()
const settings = z
  .object({ lowF: limit, highF: limit })
  .refine(({ lowF, highF }) => lowF == null || highF == null || lowF < highF)

export async function GET(request: NextRequest) {
  let access
  try {
    access = await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (access.role === 'tech' && !access.staff)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdminClient()
  const trackers = db.from('fleet_trackers')
  const boxTruck =
    access.role === 'tech'
      ? trackers
          .select(`${columns},fleet_dispatch_tracking!inner(staff_user_id)`)
          .eq('fleet_dispatch_tracking.staff_user_id', access.staff!.id)
      : trackers.select(columns)
  const { data, error } = await boxTruck
    .eq('name', BOX_TRUCK_NAME)
    .eq('enabled', true)
    .maybeSingle()
  if (error)
    return NextResponse.json(
      { error: 'Unable to load truck temperature' },
      { status: 503 },
    )

  if (access.role === 'tech' && !data)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = request.nextUrl.searchParams.get('days')
  const range = TEMPERATURE_HISTORY_RANGES.find(
    (range) => String(range.days) === days,
  )
  const history =
    data && range
      ? await db.rpc('fleet_temperature_history_summary', {
          p_tracker_id: data.id,
          p_days: range.days,
        })
      : null
  if (history?.error)
    return NextResponse.json(
      { error: 'Unable to load temperature history' },
      { status: 503 },
    )

  return NextResponse.json(
    {
      temperatureF:
        data?.probe_temperature_c == null
          ? null
          : data.probe_temperature_c * 1.8 + 32,
      receivedAt: data?.probe_received_at ?? null,
      lowF: data?.temperature_low_f ?? null,
      highF: data?.temperature_high_f ?? null,
      history: history?.data ?? [],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = settings.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Use values from −67 to 257°F and set the low below the high.' },
      { status: 400 },
    )

  const { lowF, highF } = parsed.data
  const { error, data } = await createAdminClient()
    .from('fleet_trackers')
    .update({
      temperature_low_f: lowF,
      temperature_high_f: highF,
      temperature_alarm_sent: null,
    })
    .eq('name', BOX_TRUCK_NAME)
    .eq('enabled', true)
    .select('id')
    .maybeSingle()
  if (error || !data)
    return NextResponse.json(
      { error: 'Unable to save alarm settings' },
      { status: 503 },
    )
  return NextResponse.json({ lowF, highF })
}
