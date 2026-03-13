import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { generateJobSlug } from '@/lib/slug'

type Params = { params: Promise<{ id: string }> }

// Geocode an address via Nominatim (same approach as the rest of the app)
async function geocodeAddress(
  street: string,
  city: string,
  state: string,
  zip: string,
): Promise<{
  lat: number
  lng: number
  resolvedCity: string
  neighborhood: string
} | null> {
  const query = encodeURIComponent(`${street}, ${city}, ${state} ${zip}, USA`)
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&addressdetails=1`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SasquatchCarpetCleaning/1.0 (sasquatchcc719@gmail.com)',
      },
    })
    const results = await response.json()
    if (!Array.isArray(results) || results.length === 0) return null

    const result = results[0]
    const addr = result.address ?? {}
    const resolvedCity =
      addr.city ?? addr.town ?? addr.village ?? addr.hamlet ?? city
    const neighborhood = addr.neighbourhood ?? addr.suburb ?? addr.county ?? ''

    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      resolvedCity,
      neighborhood,
    }
  } catch {
    return null
  }
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
        ops_customers ( full_name ),
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

    // Prefer an "after" photo as the hero, then any
    const heroPhoto =
      photos.find((p) => p.label === 'after') ??
      photos.find((p) => p.label === 'before') ??
      photos[0]

    // Geocode the address
    const geo = await geocodeAddress(
      address.street_1,
      address.city,
      address.state,
      address.zip_code,
    )

    const lat = geo?.lat ?? 38.8339
    const lng = geo?.lng ?? -104.8214
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

    // Build description from available data
    const servicesText = lineItemNames.filter(Boolean).join(', ')
    const totalText = invoice?.total
      ? ` — $${Number(invoice.total).toFixed(0)}`
      : ''
    const notesText = appointment.internal_notes
      ? `\n\n${appointment.internal_notes}`
      : ''
    const description =
      `${servicesText} in ${resolvedCity}, CO${totalText}.${notesText}`.trim()

    // Generate slug
    const { data: serviceRow } = await supabase
      .from('services')
      .select('name, slug')
      .eq('id', serviceId)
      .single()

    const slug = generateJobSlug(serviceRow?.name ?? servicesText, resolvedCity)

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
