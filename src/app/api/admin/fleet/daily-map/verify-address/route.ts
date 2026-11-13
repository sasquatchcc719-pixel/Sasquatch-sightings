import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import { dispatchLocation } from '@/lib/ops/daily-dispatch'
import { queueGeocodeForAddress } from '@/lib/ops/forward-geocode'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['owner', 'admin', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = z
    .object({ jobId: z.string().uuid() })
    .safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Choose a scheduled stop.' },
      { status: 400 },
    )

  const db = createAdminClient()
  const job = await db
    .from('ops_appointments')
    .select('service_address_id')
    .eq('id', parsed.data.jobId)
    .neq('status', 'cancelled')
    .is('parked_at', null)
    .maybeSingle()
  if (job.error)
    return NextResponse.json(
      { error: 'Unable to load the scheduled stop.' },
      { status: 503 },
    )
  if (!job.data?.service_address_id)
    return NextResponse.json(
      { error: 'Add a service address to this job first.' },
      { status: 422 },
    )

  const address = await db
    .from('ops_service_addresses')
    .select(
      'id,street_1,city,state,zip_code,latitude,longitude,geocoded_at,geocode_source',
    )
    .eq('id', job.data.service_address_id)
    .single()
  if (address.error)
    return NextResponse.json(
      { error: 'Unable to load the saved address.' },
      { status: 503 },
    )
  if (!dispatchLocation(address.data, null, null)) {
    await queueGeocodeForAddress(db, address.data.id, address.data)
    const saved = await db
      .from('ops_service_addresses')
      .select('latitude,longitude,geocoded_at,geocode_source')
      .eq('id', address.data.id)
      .single()
    if (saved.error)
      return NextResponse.json(
        { error: 'Unable to read the verified address.' },
        { status: 503 },
      )
    if (!dispatchLocation(saved.data, null, null))
      return NextResponse.json(
        {
          error:
            'No verified street match. Check the house number, street and ZIP.',
        },
        { status: 422 },
      )
  }
  return NextResponse.json({ ok: true })
}
