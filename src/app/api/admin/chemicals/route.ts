/**
 * Chemical inventory API (Foreman module).
 * GET  - list all products
 * POST - add a product { name, brand? } and immediately research its specs
 *        on the web. Scraped specs land as a DRAFT (scrape_status 'scraped')
 *        for Charles to review; the field assistant only uses 'reviewed' rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { scrapeProductSpecs } from '@/lib/foreman/scrape'

export async function GET() {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('chemical_products')
    .select('*')
    .order('name', { ascending: true })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ products: data ?? [] })
}

export async function POST(request: NextRequest) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const name = String(body.name ?? '').trim()
  const brand = String(body.brand ?? '').trim() || null
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: product, error } = await supabase
    .from('chemical_products')
    .insert({ name, brand, scrape_status: 'pending' })
    .select('*')
    .single()
  if (error || !product) {
    return NextResponse.json(
      { error: error?.message ?? 'Insert failed' },
      { status: 500 },
    )
  }

  // Research specs inline so the admin sees the draft as soon as the request
  // returns. Failure is non-fatal — the row stays with status 'failed' and
  // can be re-run from the UI.
  try {
    const specs = await scrapeProductSpecs(name, brand)
    const { data: updated } = await supabase
      .from('chemical_products')
      .update({
        ...specs,
        scrape_status: 'scraped',
        scrape_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', product.id)
      .select('*')
      .single()
    return NextResponse.json({ product: updated ?? product })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const { data: failed } = await supabase
      .from('chemical_products')
      .update({
        scrape_status: 'failed',
        scrape_error: detail.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', product.id)
      .select('*')
      .single()
    return NextResponse.json({ product: failed ?? product })
  }
}
