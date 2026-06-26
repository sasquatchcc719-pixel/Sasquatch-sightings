import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'marketing', 'tech'])

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('service_catalog_items')
      .select(
        'id, name, slug, category, base_price, pricing_unit, sort_order, is_active',
      )
      .eq('category', 'rug cleaning')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('base_price')

    if (error) throw error

    return NextResponse.json({ rugs: data })
  } catch (error) {
    console.error('[admin/query-rugs] Error:', error)
    return NextResponse.json({ error: 'Failed to query rugs' }, { status: 500 })
  }
}
