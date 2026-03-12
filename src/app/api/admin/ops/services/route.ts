import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

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

    const defaultDurationMinutes = Number(body.default_duration_minutes)
    const bufferMinutes = Number(body.buffer_minutes ?? 15)
    const basePrice =
      body.base_price === '' || body.base_price === null
        ? null
        : Number(body.base_price)

    const payload = {
      name,
      slug: slugify(body.slug || name),
      description: body.description ? String(body.description).trim() : null,
      category: body.category ? String(body.category).trim() : 'cleaning',
      default_duration_minutes: defaultDurationMinutes,
      buffer_minutes: bufferMinutes,
      base_price: Number.isFinite(basePrice) ? basePrice : null,
      pricing_unit: body.pricing_unit
        ? String(body.pricing_unit).trim()
        : 'fixed',
      is_active: true,
    }

    if (
      !Number.isFinite(defaultDurationMinutes) ||
      defaultDurationMinutes <= 0
    ) {
      return NextResponse.json(
        { error: 'Default duration must be a positive number' },
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
