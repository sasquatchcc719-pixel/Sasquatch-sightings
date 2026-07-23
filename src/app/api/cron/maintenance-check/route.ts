/**
 * Cron: daily maintenance-interval check. For each active rule, if the
 * asset's meter (or the calendar) has advanced past the interval since the
 * last service, create an unassigned maintenance task (once — open tasks
 * suppress re-triggering) and Telegram Charles a summary.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const [{ data: rules }, { data: assets }, { data: openTasks }] =
    await Promise.all([
      supabase.from('maintenance_rules').select('*').eq('active', true),
      supabase.from('fleet_assets').select('*').eq('active', true),
      supabase
        .from('maintenance_tasks')
        .select('rule_id')
        .in('status', ['unassigned', 'scheduled']),
    ])

  const assetById = new Map((assets ?? []).map((a) => [a.id, a]))
  const openRuleIds = new Set((openTasks ?? []).map((t) => t.rule_id))
  const created: string[] = []

  for (const rule of rules ?? []) {
    if (openRuleIds.has(rule.id)) continue
    const asset = assetById.get(rule.asset_id)
    if (!asset) continue

    let due = false
    let detail = ''
    if (rule.interval_unit === 'days') {
      const lastMs = rule.last_done_at ? Date.parse(rule.last_done_at) : 0
      const daysSince = (Date.now() - lastMs) / 86400000
      due = daysSince >= Number(rule.interval_value)
      detail = `${Math.floor(daysSince)} days since last service`
    } else {
      if (asset.current_meter == null || rule.last_done_meter == null) continue
      const delta = Number(asset.current_meter) - Number(rule.last_done_meter)
      due = delta >= Number(rule.interval_value)
      detail = `${delta} ${rule.interval_unit} since last service (interval ${rule.interval_value})`
    }
    if (!due) continue

    const title = `${asset.name}: ${rule.task_name}`
    const { error } = await supabase.from('maintenance_tasks').insert({
      rule_id: rule.id,
      asset_id: asset.id,
      title,
      status: 'unassigned',
      meter_at_trigger: asset.current_meter,
    })
    if (!error) created.push(`• ${title} — ${detail}`)
  }

  if (created.length > 0) {
    try {
      await sendTelegramNotification(
        `🔧 Maintenance due — added to the side-work queue:\n${created.join('\n')}`,
      )
    } catch (err) {
      console.error('[maintenance-check] telegram failed:', err)
    }
  }

  return NextResponse.json({ ok: true, created: created.length })
}
