import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { OPS_TEMPLATE_KEYS } from '@/lib/ops/communications'

const TEMPLATE_ORDER = OPS_TEMPLATE_KEYS

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('ops_communication_templates')
      .select('*')

    if (error) throw error

    const byKey = new Map((data || []).map((row) => [row.template_key, row]))
    const ordered = TEMPLATE_ORDER.map((key) => byKey.get(key)).filter(Boolean)

    return NextResponse.json({ templates: ordered })
  } catch (error) {
    console.error('[ops/communications/templates][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load communication templates' },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const supabase = createAdminClient()
    const body = await request.json()

    const templateKey = String(body.template_key || '').trim()
    if (
      !OPS_TEMPLATE_KEYS.includes(
        templateKey as (typeof OPS_TEMPLATE_KEYS)[number],
      )
    ) {
      return NextResponse.json(
        { error: 'Invalid template key' },
        { status: 400 },
      )
    }

    const updates = {
      is_enabled:
        body.is_enabled === undefined ? undefined : Boolean(body.is_enabled),
      subject_template:
        body.subject_template === undefined
          ? undefined
          : String(body.subject_template || '').trim() || null,
      body_template:
        body.body_template === undefined
          ? undefined
          : String(body.body_template || '').trim(),
      delay_hours:
        body.delay_hours === undefined
          ? undefined
          : Number(body.delay_hours || 0),
      updated_at: new Date().toISOString(),
    }

    if (updates.body_template !== undefined && !updates.body_template) {
      return NextResponse.json(
        { error: 'Body template cannot be empty' },
        { status: 400 },
      )
    }
    if (
      updates.delay_hours !== undefined &&
      (!Number.isFinite(updates.delay_hours) || updates.delay_hours < 0)
    ) {
      return NextResponse.json(
        { error: 'Delay hours must be zero or greater' },
        { status: 400 },
      )
    }

    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    )

    const { data, error } = await supabase
      .from('ops_communication_templates')
      .update(cleanUpdates)
      .eq('template_key', templateKey)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ template: data })
  } catch (error) {
    console.error('[ops/communications/templates][PUT] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update communication template' },
      { status: 500 },
    )
  }
}
