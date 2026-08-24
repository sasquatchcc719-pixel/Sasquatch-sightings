import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const [
      { data: products },
      { data: tasks },
      { data: rules },
      { data: assets },
    ] = await Promise.all([
      supabase
        .from('chemical_products')
        .select(
          'id, name, brand, quantity_on_hand, quantity_unit, reorder_threshold, low_stock_alerted_at',
        )
        .order('name'),
      supabase
        .from('maintenance_tasks')
        .select('id, title, status, triggered_at, asset_id')
        .in('status', ['unassigned', 'scheduled'])
        .order('triggered_at', { ascending: false }),
      supabase
        .from('maintenance_rules')
        .select(
          'id, asset_id, task_name, interval_value, interval_unit, active',
        )
        .eq('active', true),
      supabase.from('fleet_assets').select('id, name').eq('active', true),
    ])

    const low = (products ?? []).filter(
      (p) =>
        p.reorder_threshold != null &&
        p.quantity_on_hand != null &&
        Number(p.quantity_on_hand) <= Number(p.reorder_threshold),
    )

    const lines: string[] = []
    if (low.length) {
      lines.push(
        `Low truck inventory — time to reorder:\n${low
          .map(
            (p) =>
              `• ${p.name}${p.brand ? ` (${p.brand})` : ''}: ${p.quantity_on_hand} ${p.quantity_unit} left (reorder at ${p.reorder_threshold})`,
          )
          .join('\n')}`,
      )
    }
    if ((tasks ?? []).length) {
      lines.push(
        `Maintenance due — added to the side-work queue:\n${(tasks ?? [])
          .map((t) => `• ${t.title}`)
          .join('\n')}`,
      )
    }

    return NextResponse.json({
      lastSent:
        low[0]?.low_stock_alerted_at ?? tasks?.[0]?.triggered_at ?? null,
      message: lines.length ? lines.join('\n\n') : null,
      products: products ?? [],
      low,
      tasks: tasks ?? [],
      rules: rules ?? [],
      assets: assets ?? [],
    })
  } catch (err) {
    console.error('[admin/comms/telegram/truck]', err)
    return NextResponse.json({ error: 'Failed to load truck' }, { status: 500 })
  }
}
