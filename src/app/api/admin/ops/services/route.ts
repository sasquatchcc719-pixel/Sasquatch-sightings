import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { mapHousecallProPricebook } from '@/lib/ops/service-import'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('service_catalog_items')
      .select('*')
      .order('name')

    if (error) {
      throw error
    }

    return NextResponse.json({ services: data || [] })
  } catch (error) {
    console.error('[ops/services][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch service catalog' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const body = await request.json()

    const name = String(body.name || '').trim()
    if (!name) {
      return NextResponse.json(
        { error: 'Service name is required' },
        { status: 400 },
      )
    }

    const defaultDurationMinutes =
      body.default_duration_minutes === '' ||
      body.default_duration_minutes === null
        ? null
        : Number(body.default_duration_minutes)
    const bufferMinutes = Number(body.buffer_minutes ?? 30)
    const basePrice =
      body.base_price === '' || body.base_price === null
        ? null
        : Number(body.base_price)

    const payload = {
      name,
      slug: slugify(body.slug || name),
      description: body.description ? String(body.description).trim() : null,
      category: body.category ? String(body.category).trim() : 'cleaning',
      default_duration_minutes:
        defaultDurationMinutes !== null &&
        Number.isFinite(defaultDurationMinutes)
          ? defaultDurationMinutes
          : null,
      buffer_minutes: bufferMinutes,
      base_price: Number.isFinite(basePrice) ? basePrice : null,
      pricing_unit: body.pricing_unit
        ? String(body.pricing_unit).trim()
        : 'fixed',
      online_booking_enabled: Boolean(body.online_booking_enabled),
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    }

    if (
      defaultDurationMinutes !== null &&
      (!Number.isFinite(defaultDurationMinutes) || defaultDurationMinutes <= 0)
    ) {
      return NextResponse.json(
        { error: 'Default duration must be blank or a positive number' },
        { status: 400 },
      )
    }

    if (!Number.isFinite(bufferMinutes) || bufferMinutes < 0) {
      return NextResponse.json(
        { error: 'Buffer minutes must be zero or greater' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('service_catalog_items')
      .insert(payload)
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ service: data }, { status: 201 })
  } catch (error) {
    console.error('[ops/services][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create service catalog item' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const body = await request.json()

    const csvText = String(body.csv_text || '')
    if (!csvText.trim()) {
      return NextResponse.json(
        { error: 'csv_text is required' },
        { status: 400 },
      )
    }

    const { data: existingServices, error: existingServicesError } =
      await supabase.from('service_catalog_items').select('slug, source_uuid')

    if (existingServicesError) {
      throw existingServicesError
    }

    const existingSlugs = new Set(
      (existingServices || []).map((service) => service.slug),
    )
    const { services, skipped } = mapHousecallProPricebook({
      csvText,
      existingSlugs,
      defaultBufferMinutes: 30,
    })

    if (services.length === 0) {
      return NextResponse.json(
        { error: 'No importable service rows were found in the CSV' },
        { status: 400 },
      )
    }

    const bySourceUuid = new Map(
      (existingServices || [])
        .filter((service) => service.source_uuid)
        .map((service) => [service.source_uuid, service]),
    )

    const servicesToInsert = services.filter(
      (service) => !bySourceUuid.has(service.source_uuid),
    )
    const servicesToUpdate = services.filter((service) =>
      bySourceUuid.has(service.source_uuid),
    )

    const insertedServices: typeof services = []
    const updatedServices: typeof services = []

    if (servicesToInsert.length > 0) {
      const { data: insertedData, error: insertError } = await supabase
        .from('service_catalog_items')
        .insert(servicesToInsert)
        .select()

      if (insertError) {
        throw insertError
      }

      insertedServices.push(...(insertedData || []))
    }

    for (const service of servicesToUpdate) {
      const existing = bySourceUuid.get(service.source_uuid)
      if (!existing?.source_uuid) continue

      const { data: updatedData, error: updateError } = await supabase
        .from('service_catalog_items')
        .update({
          ...service,
          slug: existing.slug,
        })
        .eq('source_uuid', existing.source_uuid)
        .select()
        .single()

      if (updateError) {
        throw updateError
      }

      updatedServices.push(updatedData)
    }

    return NextResponse.json({
      imported: insertedServices.length + updatedServices.length,
      skipped,
      services: [...insertedServices, ...updatedServices],
    })
  } catch (error) {
    console.error('[ops/services][PUT] Error:', error)
    return NextResponse.json(
      { error: 'Failed to import service catalog CSV' },
      { status: 500 },
    )
  }
}
