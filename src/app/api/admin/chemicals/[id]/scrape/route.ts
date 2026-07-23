/**
 * Re-run web spec research for one chemical product.
 * Overwrites the draft spec fields; approval state resets to 'scraped'
 * so Charles re-reviews before the field assistant trusts the new data.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { scrapeProductSpecs } from '@/lib/foreman/scrape'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const supabase = createAdminClient()
  const { data: product, error } = await supabase
    .from('chemical_products')
    .select('id, name, brand')
    .eq('id', id)
    .maybeSingle()
  if (error || !product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  try {
    const specs = await scrapeProductSpecs(product.name, product.brand)
    const { data: updated, error: updateError } = await supabase
      .from('chemical_products')
      .update({
        ...specs,
        scrape_status: 'scraped',
        scrape_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    return NextResponse.json({ product: updated })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const { data: failed } = await supabase
      .from('chemical_products')
      .update({
        scrape_status: 'failed',
        scrape_error: detail.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()
    return NextResponse.json({ product: failed }, { status: 200 })
  }
}
