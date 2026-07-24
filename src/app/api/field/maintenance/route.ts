/**
 * David's self-serve maintenance view (tech-accessible).
 * GET   - open maintenance tasks (unassigned/scheduled), with asset names.
 * PATCH - { taskId, action: 'complete' | 'dismiss' } mark it done, which
 *         restarts the underlying rule's interval clock.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { setMaintenanceTaskStatus } from '@/lib/ops/fleet-maintenance'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const { data: tasks, error } = await supabase
    .from('maintenance_tasks')
    .select('id, asset_id, title, status, meter_at_trigger, triggered_at')
    .in('status', ['unassigned', 'scheduled'])
    .order('triggered_at', { ascending: true })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const assetIds = [...new Set((tasks ?? []).map((t) => t.asset_id))]
  const { data: assets } = assetIds.length
    ? await supabase
        .from('fleet_assets')
        .select('id, name, meter_type')
        .in('id', assetIds)
    : { data: [] }
  const assetById = new Map((assets ?? []).map((a) => [a.id, a]))

  const enriched = (tasks ?? []).map((t) => ({
    ...t,
    asset_name: assetById.get(t.asset_id)?.name ?? 'Unknown asset',
    meter_type: assetById.get(t.asset_id)?.meter_type ?? 'miles',
  }))

  return NextResponse.json({ tasks: enriched })
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const body = await request.json()
  const taskId = String(body.taskId ?? '')
  const action = String(body.action ?? '')
  if (!taskId || !['complete', 'dismiss'].includes(action)) {
    return NextResponse.json(
      { error: 'taskId and a valid action are required' },
      { status: 400 },
    )
  }
  const status = action === 'complete' ? 'completed' : 'dismissed'
  try {
    const task = await setMaintenanceTaskStatus(supabase, taskId, status)
    return NextResponse.json({ task })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 },
    )
  }
}
