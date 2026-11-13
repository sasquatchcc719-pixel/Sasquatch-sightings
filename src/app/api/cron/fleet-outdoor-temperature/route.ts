import { NextRequest, NextResponse } from 'next/server'
import { getTruckWeather } from '@/lib/tech/truck-weather'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const weather = await getTruckWeather()
  if (weather.currentF == null || !weather.observedAt || !weather.stationName)
    return NextResponse.json({ saved: false })

  const { error } = await createAdminClient()
    .from('fleet_outdoor_temperature')
    .upsert(
      {
        observed_at: weather.observedAt,
        temperature_f: weather.currentF,
        station_name: weather.stationName,
      },
      { onConflict: 'observed_at', ignoreDuplicates: true },
    )
  if (error) {
    console.error('[fleet-outdoor-temperature]', error.code)
    return NextResponse.json(
      { error: 'Unable to save observation' },
      { status: 503 },
    )
  }
  return NextResponse.json({ saved: true })
}
