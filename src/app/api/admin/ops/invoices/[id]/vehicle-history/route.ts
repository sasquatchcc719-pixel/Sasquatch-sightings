import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

// Intentionally separate from the shared invoice response used by technicians,
// customers, PDFs, email, and billing integrations.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['owner', 'admin', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: 'Invalid invoice' }, { status: 400 })
  const db = createAdminClient()
  const invoice = await db
    .from('ops_invoices')
    .select('appointment_id')
    .eq('id', id)
    .maybeSingle()
  if (invoice.error)
    return NextResponse.json(
      { error: 'Unable to load vehicle history' },
      { status: 503 },
    )
  if (!invoice.data)
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  const appointmentId = invoice.data.appointment_id
  if (!appointmentId)
    return NextResponse.json(
      { visits: [], trips: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  const [visits, trips] = await Promise.all([
    db
      .from('fleet_job_visits')
      .select('id,tracker_name,location_label,arrived_at,departed_at')
      .eq('appointment_id', appointmentId)
      .order('arrived_at')
      .limit(100),
    db
      .from('fleet_job_trips')
      .select(
        'id,tracker_name,origin_appointment_id,destination_appointment_id,origin_label,destination_label,departed_at,arrived_at,last_observed_at,status,observed_distance_m,signal_gaps,route,route_truncated',
      )
      .eq('confirmed', true)
      .or(
        `origin_appointment_id.eq.${appointmentId},destination_appointment_id.eq.${appointmentId}`,
      )
      .order('departed_at')
      .limit(100),
  ])
  if (visits.error || trips.error)
    return NextResponse.json(
      { error: 'Unable to load vehicle history' },
      { status: 503 },
    )
  return NextResponse.json(
    { appointmentId, visits: visits.data, trips: trips.data },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
