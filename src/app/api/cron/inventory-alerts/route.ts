/**
 * Cron: daily low-stock check on the truck inventory.
 * Alerts once per threshold crossing (low_stock_alerted_at re-arms when the
 * field counter goes back above the threshold or a restock is logged).
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
  const { data: products, error } = await supabase
    .from('chemical_products')
    .select(
      'id, name, brand, quantity_on_hand, quantity_unit, reorder_threshold, low_stock_alerted_at',
    )
    .not('reorder_threshold', 'is', null)
    .not('quantity_on_hand', 'is', null)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const due = (products ?? []).filter(
    (p) =>
      Number(p.quantity_on_hand) <= Number(p.reorder_threshold) &&
      !p.low_stock_alerted_at,
  )
  if (due.length === 0) {
    return NextResponse.json({ ok: true, alerted: 0 })
  }

  const lines = due.map(
    (p) =>
      `• ${p.name}${p.brand ? ` (${p.brand})` : ''}: ${p.quantity_on_hand} ${p.quantity_unit} left (reorder at ${p.reorder_threshold})`,
  )
  try {
    await sendTelegramNotification(
      `📦 Low truck inventory — time to reorder:\n${lines.join('\n')}`,
    )
  } catch (err) {
    console.error('[inventory-alerts] telegram failed:', err)
    return NextResponse.json({ error: 'notify failed' }, { status: 500 })
  }

  await supabase
    .from('chemical_products')
    .update({ low_stock_alerted_at: new Date().toISOString() })
    .in(
      'id',
      due.map((p) => p.id),
    )

  return NextResponse.json({ ok: true, alerted: due.length })
}
