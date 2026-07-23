/**
 * Single chemical product API.
 * PATCH  - edit spec fields, toggle in_stock, or approve the scraped draft
 *          (action: 'approve' sets scrape_status 'reviewed')
 * DELETE - remove the product
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'

const EDITABLE_FIELDS = [
  'name',
  'brand',
  'item_type',
  'in_stock',
  'image_url',
  'quantity_on_hand',
  'quantity_unit',
  'reorder_threshold',
  'ph_range',
  'dilution_hydroforce',
  'dilution_pump_sprayer',
  'label_instructions',
  'sds_warnings',
  'scenarios',
  'incompatible_with',
  'notes',
] as const

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const body = await request.json()

  const update: Record<string, unknown> = {}
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field]
  }
  if (body.action === 'approve') {
    update.scrape_status = 'reviewed'
    update.scrape_error = null
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  update.updated_at = new Date().toISOString()

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('chemical_products')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ product: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('chemical_products')
    .delete()
    .eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
