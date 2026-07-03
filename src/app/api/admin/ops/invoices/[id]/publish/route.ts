import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { generateJobSlug } from '@/lib/slug'
import { generateSEOFilename } from '@/lib/seo-filename'
import {
  effectiveInvoiceAmount,
  utilizationHoursFromAppointment,
} from '@/lib/ops/utilization-metrics'
import { enqueue } from '@/lib/echo/enqueue'
import { enrollCustomerInDrip } from '@/lib/ops/drip-campaign'
import { buildJobUrl, notifyGoogleIndexing } from '@/lib/google-indexing'
import { assertTechInvoiceAccess } from '@/lib/ops/tech-job-access'
import sharp from 'sharp'

type Params = { params: Promise<{ id: string }> }

async function resolveServiceId(
  supabase: ReturnType<typeof createAdminClient>,
  lineItemNames: string[],
): Promise<{ id: string; name: string; slug: string } | null> {
  const { data: services } = await supabase
    .from('services')
    .select('id, name, slug')

  if (!services || services.length === 0) return null

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
      if (tile) return tile
    }
    if (
      lower.includes('upholstery') ||
      lower.includes('couch') ||
      lower.includes('sofa')
    ) {
      if (upholstery) return upholstery
    }
    if (
      lower.includes('carpet') ||
      lower.includes('room') ||
      lower.includes('stair')
    ) {
      if (carpet) return carpet
    }
  }

  return carpet ?? services[0] ?? null
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id: invoiceId } = await params
    await assertTechInvoiceAccess(supabase, access, invoiceId)

    const formData = await request.formData()
    const imageFile = formData.get('image') as File | null
    const description = formData.get('description') as string | null

    if (!imageFile || !description?.trim()) {
      return NextResponse.json(
        { error: 'Image and description are required' },
        { status: 400 },
      )
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .select(
        `
        id,
        total,
        ops_invoice_line_items (
          line_total
        ),
        ops_appointments (
          id,
          appointment_date,
          start_time,
          end_time,
          quoted_total,
          on_my_way_at,
          completed_at,
          gps_lat,
          gps_lng,
          ops_service_addresses (
            street_1, city, state, zip_code
          ),
          ops_appointment_line_items ( name_snapshot )
        )
      `,
      )
      .eq('id', invoiceId)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const appointment = Array.isArray(invoice.ops_appointments)
      ? invoice.ops_appointments[0]
      : invoice.ops_appointments
    if (!appointment) {
      return NextResponse.json(
        { error: 'No appointment linked to this invoice' },
        { status: 400 },
      )
    }

    const address = Array.isArray(appointment.ops_service_addresses)
      ? appointment.ops_service_addresses[0]
      : appointment.ops_service_addresses
    if (!address) {
      return NextResponse.json(
        { error: 'No service address on this appointment' },
        { status: 400 },
      )
    }

    const publishNowIso = new Date().toISOString()
    const completedAtExisting = (
      appointment as { completed_at?: string | null }
    ).completed_at
    const completedAtForStats = completedAtExisting ?? publishNowIso

    // Mark appointment completed; stamp completed_at once so utilization hours can use OMW → done.
    await supabase
      .from('ops_appointments')
      .update({
        status: 'completed',
        completed_at: completedAtForStats,
        updated_at: publishNowIso,
      })
      .eq('id', appointment.id)

    await enrollCustomerInDrip(appointment.id)

    const invLines = Array.isArray(invoice.ops_invoice_line_items)
      ? invoice.ops_invoice_line_items
      : invoice.ops_invoice_line_items
        ? [invoice.ops_invoice_line_items]
        : []

    let hoursWorked: number | null = utilizationHoursFromAppointment({
      on_my_way_at: (appointment as { on_my_way_at?: string | null })
        .on_my_way_at,
      completed_at: completedAtForStats,
      start_time: appointment.start_time,
      end_time: appointment.end_time,
    })
    if (hoursWorked <= 0) hoursWorked = null

    const invoiceTotal = effectiveInvoiceAmount({
      invoiceTotal: Number(invoice.total || 0),
      invoiceLineItems: invLines,
      quotedTotal: Number(
        (appointment as { quoted_total?: number }).quoted_total || 0,
      ),
    })

    const capturedLat = Number(
      (appointment as { gps_lat?: number | string | null }).gps_lat,
    )
    const capturedLng = Number(
      (appointment as { gps_lng?: number | string | null }).gps_lng,
    )
    const hasCapturedGps =
      Number.isFinite(capturedLat) &&
      Number.isFinite(capturedLng) &&
      capturedLat >= -90 &&
      capturedLat <= 90 &&
      capturedLng >= -180 &&
      capturedLng <= 180

    if (!hasCapturedGps) {
      return NextResponse.json(
        {
          error:
            'Capture GPS on the invoice before publishing so the map pin uses the job-site location.',
        },
        { status: 400 },
      )
    }

    const lat = capturedLat
    const lng = capturedLng
    const resolvedCity = address.city
    const neighborhood = ''

    const fuzzOffset = 0.002
    const fuzzLat = lat + (Math.random() - 0.5) * fuzzOffset
    const fuzzLng = lng + (Math.random() - 0.5) * fuzzOffset

    // Resolve service from line items
    const rawLineItems = Array.isArray(appointment.ops_appointment_line_items)
      ? appointment.ops_appointment_line_items
      : appointment.ops_appointment_line_items
        ? [appointment.ops_appointment_line_items]
        : []
    const lineItemNames = rawLineItems.map((li: { name_snapshot?: string }) =>
      String(li.name_snapshot ?? ''),
    )

    const service = await resolveServiceId(supabase, lineItemNames)
    if (!service) {
      return NextResponse.json(
        { error: 'No matching service found in catalog' },
        { status: 400 },
      )
    }

    // Optimize image with Sharp
    const arrayBuffer = await imageFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const optimizedBuffer = await sharp(buffer)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()

    const filename = generateSEOFilename(
      service.slug,
      resolvedCity,
      address.state,
      imageFile.name,
    )

    const { error: uploadError } = await supabase.storage
      .from('job-images')
      .upload(filename, optimizedBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      console.error('[publish] Storage upload error:', uploadError)
      return NextResponse.json(
        { error: 'Failed to upload image' },
        { status: 500 },
      )
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('job-images').getPublicUrl(filename)

    const slug = generateJobSlug(service.name, resolvedCity)

    // Insert job record
    const { data: job, error: insertError } = await supabase
      .from('jobs')
      .insert({
        service_id: service.id,
        image_url: publicUrl,
        image_filename: filename,
        gps_lat: lat,
        gps_lng: lng,
        gps_fuzzy_lat: fuzzLat,
        gps_fuzzy_lng: fuzzLng,
        city: resolvedCity,
        neighborhood,
        // Provenance: the factual inputs the description was generated from
        // (was a duplicate of ai_description, which destroyed the audit trail).
        raw_voice_input: lineItemNames.filter(Boolean).join(', ') || null,
        ai_description: description,
        slug,
        status: 'published',
        published_at: new Date().toISOString(),
        ops_invoice_id: invoiceId,
        ...(invoiceTotal > 0 ? { invoice_amount: invoiceTotal } : {}),
        ...(hoursWorked ? { hours_worked: hoursWorked } : {}),
      })
      .select()
      .single()

    if (insertError) {
      console.error('[publish] Job insert error:', insertError)
      return NextResponse.json(
        { error: 'Failed to create job record' },
        { status: 500 },
      )
    }

    // Stats: published jobs contribute via `jobs` (invoice_amount + hours_worked).
    // If this invoice had a prior "stats only" revenue_entries row, remove it so the dashboard does not double-count.
    await supabase
      .from('revenue_entries')
      .delete()
      .eq('ops_invoice_id', invoiceId)

    // Ping Google's Indexing API so the new public page gets crawled promptly.
    // (Previously only the legacy /api/jobs/[id] PATCH route did this, so jobs
    // published through this flow were never announced to Google.)
    if (job.city && job.slug) {
      notifyGoogleIndexing(buildJobUrl(job.city, job.slug)).catch(() => {})
    }

    // Hand off to Echo for editorial decision + distribution.
    // Echo reads echo_settings, decides skip / map_only / draft / auto_post,
    // generates varied copy (OpenAI), writes a row to social_post_drafts,
    // and (if auto_post) fires the Zaps + logs to social_post_log.
    let echoResult: Awaited<ReturnType<typeof enqueue>> = {
      action: 'skip',
      reason: 'Echo enqueue did not run',
    }
    try {
      echoResult = await enqueue(job.id)
    } catch (echoErr) {
      console.error('[publish] Echo enqueue threw:', echoErr)
      echoResult = {
        action: 'skip',
        reason:
          echoErr instanceof Error
            ? `Echo enqueue error: ${echoErr.message}`
            : 'Echo enqueue threw unknown error',
      }
    }

    return NextResponse.json(
      {
        ok: true,
        job: {
          id: job.id,
          slug: job.slug,
          city: job.city,
          imageUrl: job.image_url,
        },
        echo: echoResult,
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[publish] Error:', err)
    const message = err instanceof Error ? err.message : 'Failed to publish job'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
