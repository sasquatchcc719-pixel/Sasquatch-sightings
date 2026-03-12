import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()

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

    const updates = {
      name: body.name ? String(body.name).trim() : undefined,
      description:
        body.description === undefined
          ? undefined
          : String(body.description || '').trim() || null,
      category: body.category ? String(body.category).trim() : undefined,
      default_duration_minutes:
        defaultDurationMinutes !== null &&
        Number.isFinite(defaultDurationMinutes)
          ? defaultDurationMinutes
          : defaultDurationMinutes,
      buffer_minutes: bufferMinutes,
      base_price: Number.isFinite(basePrice) ? basePrice : null,
      pricing_unit: body.pricing_unit
        ? String(body.pricing_unit).trim()
        : undefined,
      online_booking_enabled:
        body.online_booking_enabled === undefined
          ? undefined
          : Boolean(body.online_booking_enabled),
      is_active:
        body.is_active === undefined ? undefined : Boolean(body.is_active),
      updated_at: new Date().toISOString(),
    }

    const cleanedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    )

    const { data, error } = await supabase
      .from('service_catalog_items')
      .update(cleanedUpdates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ service: data })
  } catch (error) {
    console.error('[ops/services/:id][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update service catalog item' },
      { status: 500 },
    )
  }
}
