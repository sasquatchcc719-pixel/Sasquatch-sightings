import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Save GPS coordinates to an appointment.
 * Used when finishing a job to capture real on-site coordinates
 * (more accurate than geocoding from address).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const supabase = createAdminClient()
    const { id: appointmentId } = await params
    const body = await request.json()

    const lat = Number(body.lat)
    const lng = Number(body.lng)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: 'Invalid GPS coordinates' },
        { status: 400 },
      )
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { error: 'GPS coordinates out of valid range' },
        { status: 400 },
      )
    }

    const { error } = await supabase
      .from('ops_appointments')
      .update({
        gps_lat: lat,
        gps_lng: lng,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)

    if (error) throw error

    return NextResponse.json({ success: true, gps_lat: lat, gps_lng: lng })
  } catch (error) {
    console.error('[ops/appointments/:id/gps][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to save GPS coordinates' },
      { status: 500 },
    )
  }
}
