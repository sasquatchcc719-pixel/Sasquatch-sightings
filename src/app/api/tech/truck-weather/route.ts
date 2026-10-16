import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getTruckWeather } from '@/lib/tech/truck-weather'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await getTruckWeather(), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
