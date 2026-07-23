/**
 * Field inventory quick-adjust (tech-accessible).
 * GET  - product list with quantities for the field counter screen
 * POST - { productId, delta } bump quantity_on_hand (min 0). Rising back
 *        above the reorder threshold re-arms the low-stock alert.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('chemical_products')
    .select(
      'id, name, brand, image_url, item_type, in_stock, quantity_on_hand, quantity_unit, reorder_threshold',
    )
    .order('name', { ascending: true })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ products: data ?? [] })
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const body = await request.json()
  const productId = String(body.productId ?? '')
  const delta = Number(body.delta)
  if (!productId || !Number.isFinite(delta)) {
    return NextResponse.json(
      { error: 'productId and delta required' },
      { status: 400 },
    )
  }

  const { data: product } = await supabase
    .from('chemical_products')
    .select('id, quantity_on_hand, reorder_threshold')
    .eq('id', productId)
    .maybeSingle()
  if (!product) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const next = Math.max(0, Number(product.quantity_on_hand ?? 0) + delta)
  const update: Record<string, unknown> = {
    quantity_on_hand: next,
    updated_at: new Date().toISOString(),
  }
  // Restocked above threshold → re-arm the alert; hitting zero also flips
  // the in_stock flag the Foreman assistant honors.
  if (product.reorder_threshold != null && next > product.reorder_threshold) {
    update.low_stock_alerted_at = null
  }
  if (next === 0) update.in_stock = false
  if (delta > 0) update.in_stock = true

  const { data: updated, error } = await supabase
    .from('chemical_products')
    .update(update)
    .eq('id', productId)
    .select(
      'id, name, brand, image_url, item_type, in_stock, quantity_on_hand, quantity_unit, reorder_threshold',
    )
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ product: updated })
}
