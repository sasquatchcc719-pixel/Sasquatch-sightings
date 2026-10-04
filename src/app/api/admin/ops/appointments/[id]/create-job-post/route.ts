import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { generateJobSlug } from '@/lib/slug'
import { generateJobDescription } from '@/lib/ai'
import { forwardGeocodeAddress } from '@/lib/ops/forward-geocode'

type Params = { params: Promise<{ id: string }> }

function validColoradoPoint(
  latValue: number | string | null,
  lngValue: number | string | null,
): { lat: number; lng: number } | null {
  const lat = Number(latValue)
  const lng = Number(lngValue)
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < 36.8 ||
    lat > 41.2 ||
    lng < -109.2 ||
    lng > -101.8
  ) {
    return null
  }
  return { lat, lng }
}

// Try to find a matching service in the old `services` table by name similarity
async function resolveServiceId(
  supabase: ReturnType<typeof createAdminClient>,
  lineItemNames: string[],
): Promise<string | null> {
  const { data: services } = await supabase.from('services').select('id, name')

  if (!services || services.length === 0) return null

  // Try to find a match by keywords
  const carpet = services.find((s) => s.name.toLowerCase().includes('carpet'))
  const upholstery = services.find((s) =>
    s.name.toLowerCase().includes('upholstery'),
  )
  const tile = services.find(
    (s) =>
      s.name.toLowerCase().includes('tile') ||
      s.name.toLowerCase().includes('grout'),
  )

  for (const itemName of lineItemNames) {
    const lower = itemName.toLowerCase()
    if (lower.includes('tile') || lower.includes('grout')) {
      if (tile) return tile.id
    }
    if (
      lower.includes('upholstery') ||
      lower.includes('couch') ||
      lower.includes('sofa')
    ) {
      if (upholstery) return upholstery.id
    }
    if (
      lower.includes('carpet') ||
      lower.includes('room') ||
      lower.includes('stair')
    ) {
      if (carpet) return carpet.id
    }
  }

  // Default to carpet, then first available
  return carpet?.id ?? services[0]?.id ?? null
}

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id: appointmentId } = await params

    // Fetch appointment with all related data
    const { data: appointment, error: apptError } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        appointment_date,
        internal_notes,
        gps_lat,
        gps_lng,
        ops_customers!ops_appointments_customer_id_fkey ( full_name ),
        ops_service_addresses (
          street_1, city, state, zip_code
        ),
        ops_appointment_line_items ( name_snapshot ),
        ops_invoices ( total )
      `,
      )
      .eq('id', appointmentId)
      .single()

    if (apptError || !appointment) {
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 },
      )
    }

    // Unwrap relations (Supabase can return array or object)
    function unwrap<T>(val: T | T[] | null | undefined): T | null {
      if (!val) return null
      return Array.isArray(val) ? (val[0] ?? null) : val
    }

    const address = unwrap(
      appointment.ops_service_addresses as
        | { street_1: string; city: string; state: string; zip_code: string }
        | { street_1: string; city: string; state: string; zip_code: string }[]
        | null,
    )
    const customer = unwrap(
      appointment.ops_customers as
        | { full_name: string }
        | { full_name: string }[]
        | null,
    )
    const lineItems = Array.isArray(appointment.ops_appointment_line_items)
      ? appointment.ops_appointment_line_items
      : appointment.ops_appointment_line_items
        ? [appointment.ops_appointment_line_items]
        : []
    const invoice = unwrap(
      appointment.ops_invoices as
        | { total: number }
        | { total: number }[]
        | null,
    )

    if (!address) {
      return NextResponse.json(
        { error: 'No service address on this appointment' },
        { status: 400 },
      )
    }

    // Fetch photos for this appointment
    const { data: photos } = await supabase
      .from('ops_job_photos')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true })

    if (!photos || photos.length === 0) {
      return NextResponse.json(
        { error: 'Upload at least one photo before creating a job post.' },
        { status: 400 },
      )
    }

    // Fiber check photos are evidence, not marketing — a customer's care tag
    // or rug backing must never become the hero of a public job post.
    const publishablePhotos = photos.filter(
      (p: { label?: string | null }) => p.label !== 'fiber_check',
    )
    if (publishablePhotos.length === 0) {
      return NextResponse.json(
        {
          error:
            'This job only has fiber check photos. Upload a job photo before creating a job post.',
        },
        { status: 400 },
      )
    }

    // Prefer an "after" photo as the hero, then any
    const heroPhoto =
      publishablePhotos.find((p) => p.label === 'after') ??
      publishablePhotos.find((p) => p.label === 'before') ??
      publishablePhotos[0]

    // Prefer coordinates captured at the completed job. If they are missing,
    // accept only a verified street-level geocode—never a city-center default.
    const onsitePoint = validColoradoPoint(
      appointment.gps_lat,
      appointment.gps_lng,
    )
    const geo = onsitePoint
      ? null
      : await forwardGeocodeAddress({
          street_1: address.street_1,
          city: address.city,
          state: address.state,
          zip_code: address.zip_code,
        })
    const verifiedPoint = onsitePoint ?? geo
    if (!verifiedPoint) {
      return NextResponse.json(
        {
          error:
            'This job has no captured GPS and its street address could not be verified. Capture the job location or correct the address before creating a public post.',
        },
        { status: 422 },
      )
    }

    const lat = verifiedPoint.lat
    const lng = verifiedPoint.lng
    const resolvedCity = geo?.resolvedCity ?? address.city
    const neighborhood = geo?.neighborhood ?? ''

    // Fuzz GPS ~200m for public display
    const fuzzOffset = 0.002
    const fuzzLat = lat + (Math.random() - 0.5) * fuzzOffset
    const fuzzLng = lng + (Math.random() - 0.5) * fuzzOffset

    // Resolve service
    const lineItemNames = lineItems.map((li) => String(li.name_snapshot ?? ''))
    const serviceId = await resolveServiceId(supabase, lineItemNames)

    if (!serviceId) {
      return NextResponse.json(
        {
          error:
            'No matching service found. Add a service in the Sightings catalog first.',
        },
        { status: 400 },
      )
    }

    // Generate slug + service name
    const { data: serviceRow } = await supabase
      .from('services')
      .select('name, slug')
      .eq('id', serviceId)
      .single()

    const servicesText = lineItemNames.filter(Boolean).join(', ')
    const serviceName = serviceRow?.name ?? servicesText
    const slug = generateJobSlug(serviceName, resolvedCity)

    // Build a voice note for the AI to work from
    const voiceNote = [
      servicesText,
      appointment.internal_notes ?? '',
      invoice?.total ? `Total: $${Number(invoice.total).toFixed(0)}` : '',
    ]
      .filter(Boolean)
      .join('. ')

    // Generate AI description (falls back to plain text if AI unavailable)
    let description = `${servicesText} in ${resolvedCity}, CO.`
    try {
      description = await generateJobDescription(
        voiceNote,
        serviceName,
        resolvedCity,
        neighborhood || null,
      )
    } catch (aiErr) {
      console.error(
        '[create-job-post] AI description failed, using fallback:',
        aiErr,
      )
    }

    // Create DRAFT job record
    const { data: job, error: insertError } = await supabase
      .from('jobs')
      .insert({
        service_id: serviceId,
        image_url: heroPhoto.public_url,
        image_filename: heroPhoto.storage_path.split('/').pop() ?? 'photo.jpg',
        gps_lat: lat,
        gps_lng: lng,
        gps_fuzzy_lat: fuzzLat,
        gps_fuzzy_lng: fuzzLng,
        city: resolvedCity,
        neighborhood,
        raw_voice_input: description,
        ai_description: description,
        slug,
        status: 'draft',
        invoice_amount: invoice?.total ? Number(invoice.total) : null,
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ jobId: job.id }, { status: 201 })
  } catch (err) {
    console.error('[create-job-post][POST]', err)
    return NextResponse.json(
      { error: 'Failed to create job post' },
      { status: 500 },
    )
  }
}
