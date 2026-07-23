/**
 * Fleet admin API — assets, maintenance rules, and triggered tasks in one
 * resource-discriminated route.
 * GET    - assets (with rules) + open/recent maintenance tasks
 * POST   - { resource: 'asset' | 'rule', ...fields } create
 * PATCH  - { resource: 'asset' | 'rule' | 'task', id, ...fields } update.
 *          Completing a task stamps its rule's last_done_* so the interval
 *          clock restarts.
 * DELETE - ?resource=asset|rule&id=
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

async function guard() {
  await requireAnyRole(['admin', 'owner'])
}

export async function GET() {
  try {
    await guard()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const [{ data: assets }, { data: rules }, { data: tasks }] =
    await Promise.all([
      supabase.from('fleet_assets').select('*').order('name'),
      supabase.from('maintenance_rules').select('*').order('created_at'),
      supabase
        .from('maintenance_tasks')
        .select('*')
        .order('triggered_at', { ascending: false })
        .limit(100),
    ])
  return NextResponse.json({
    assets: assets ?? [],
    rules: rules ?? [],
    tasks: tasks ?? [],
  })
}

export async function POST(request: NextRequest) {
  try {
    await guard()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const body = await request.json()

  if (body.resource === 'asset') {
    const { data, error } = await supabase
      .from('fleet_assets')
      .insert({
        name: String(body.name ?? '').trim(),
        asset_type: body.asset_type ?? 'van',
        meter_type: body.meter_type ?? 'miles',
        current_meter: body.current_meter ?? null,
        notes: body.notes ?? null,
      })
      .select('*')
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ asset: data })
  }

  if (body.resource === 'rule') {
    // Baseline the interval clock at the asset's current meter so a fresh
    // rule doesn't instantly trigger on an old vehicle.
    const { data: asset } = await supabase
      .from('fleet_assets')
      .select('current_meter')
      .eq('id', body.asset_id)
      .maybeSingle()
    const { data, error } = await supabase
      .from('maintenance_rules')
      .insert({
        asset_id: body.asset_id,
        task_name: String(body.task_name ?? '').trim(),
        interval_value: Number(body.interval_value),
        interval_unit: body.interval_unit ?? 'miles',
        est_duration_minutes: Number(body.est_duration_minutes ?? 60),
        last_done_meter: asset?.current_meter ?? 0,
        last_done_at: new Date().toISOString(),
      })
      .select('*')
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ rule: data })
  }

  return NextResponse.json({ error: 'Unknown resource' }, { status: 400 })
}

export async function PATCH(request: NextRequest) {
  try {
    await guard()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const body = await request.json()
  const id = String(body.id ?? '')
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  if (body.resource === 'asset') {
    const fields = [
      'name',
      'asset_type',
      'meter_type',
      'current_meter',
      'active',
      'notes',
    ]
    const update: Record<string, unknown> = {}
    for (const f of fields) if (f in body) update[f] = body[f]
    const { data, error } = await supabase
      .from('fleet_assets')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ asset: data })
  }

  if (body.resource === 'rule') {
    const fields = [
      'task_name',
      'interval_value',
      'interval_unit',
      'est_duration_minutes',
      'active',
    ]
    const update: Record<string, unknown> = {}
    for (const f of fields) if (f in body) update[f] = body[f]
    const { data, error } = await supabase
      .from('maintenance_rules')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ rule: data })
  }

  if (body.resource === 'task') {
    const status = String(body.status ?? '')
    if (!['completed', 'dismissed', 'unassigned'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const { data: task, error } = await supabase
      .from('maintenance_tasks')
      .update({
        status,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    // Completing service restarts the rule's interval clock at the asset's
    // current meter/date.
    if (status === 'completed' && task?.rule_id) {
      const { data: asset } = await supabase
        .from('fleet_assets')
        .select('current_meter')
        .eq('id', task.asset_id)
        .maybeSingle()
      await supabase
        .from('maintenance_rules')
        .update({
          last_done_meter: asset?.current_meter ?? null,
          last_done_at: new Date().toISOString(),
        })
        .eq('id', task.rule_id)
    }
    return NextResponse.json({ task })
  }

  return NextResponse.json({ error: 'Unknown resource' }, { status: 400 })
}

export async function DELETE(request: NextRequest) {
  try {
    await guard()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const resource = request.nextUrl.searchParams.get('resource')
  const id = request.nextUrl.searchParams.get('id')
  if (!id || !['asset', 'rule'].includes(resource ?? '')) {
    return NextResponse.json(
      { error: 'resource (asset|rule) and id required' },
      { status: 400 },
    )
  }
  const table = resource === 'asset' ? 'fleet_assets' : 'maintenance_rules'
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
