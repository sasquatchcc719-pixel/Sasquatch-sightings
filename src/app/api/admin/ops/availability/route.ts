import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const supabase = createAdminClient()

    const [templatesResult, overridesResult] = await Promise.all([
      supabase
        .from('availability_templates')
        .select('*')
        .order('day_of_week')
        .order('start_time'),
      supabase
        .from('availability_overrides')
        .select('*')
        .order('override_date')
        .order('start_time'),
    ])

    if (templatesResult.error) throw templatesResult.error
    if (overridesResult.error) throw overridesResult.error

    return NextResponse.json({
      templates: templatesResult.data || [],
      overrides: overridesResult.data || [],
    })
  } catch (error) {
    console.error('[ops/availability][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch availability data' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const body = await request.json()

    if (body.kind === 'template') {
      const payload = {
        day_of_week: Number(body.day_of_week),
        start_time: String(body.start_time),
        end_time: String(body.end_time),
        slot_interval_minutes: Number(body.slot_interval_minutes || 30),
        is_active: true,
      }

      const { data, error } = await supabase
        .from('availability_templates')
        .insert(payload)
        .select()
        .single()

      if (error) throw error

      return NextResponse.json({ template: data }, { status: 201 })
    }

    if (body.kind === 'override') {
      const payload = {
        override_date: String(body.override_date),
        start_time: body.start_time ? String(body.start_time) : null,
        end_time: body.end_time ? String(body.end_time) : null,
        is_available: Boolean(body.is_available),
        reason: body.reason ? String(body.reason).trim() : null,
      }

      const { data, error } = await supabase
        .from('availability_overrides')
        .insert(payload)
        .select()
        .single()

      if (error) throw error

      return NextResponse.json({ override: data }, { status: 201 })
    }

    return NextResponse.json(
      { error: 'kind must be template or override' },
      { status: 400 },
    )
  } catch (error) {
    console.error('[ops/availability][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to save availability rule' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const body = await request.json()
    const templates = Array.isArray(body?.templates) ? body.templates : null

    if (!templates || templates.length === 0) {
      return NextResponse.json(
        { error: 'templates array is required' },
        { status: 400 },
      )
    }

    const normalizedTemplates = templates.map(
      (template: {
        day_of_week: number
        start_time: string
        end_time: string
        slot_interval_minutes?: number
      }) => ({
        day_of_week: Number(template.day_of_week),
        start_time: String(template.start_time),
        end_time: String(template.end_time),
        slot_interval_minutes: Number(template.slot_interval_minutes || 30),
        is_active: true,
      }),
    )

    const { error: deleteError } = await supabase
      .from('availability_templates')
      .delete()
      .gte('day_of_week', 0)

    if (deleteError) throw deleteError

    const { data, error: insertError } = await supabase
      .from('availability_templates')
      .insert(normalizedTemplates)
      .select('*')
      .order('day_of_week')
      .order('start_time')

    if (insertError) throw insertError

    return NextResponse.json({ templates: data || [] })
  } catch (error) {
    console.error('[ops/availability][PUT] Error:', error)
    return NextResponse.json(
      { error: 'Failed to save business hours templates' },
      { status: 500 },
    )
  }
}
