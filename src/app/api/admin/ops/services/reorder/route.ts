import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const body = await request.json()
    const orderedIds = Array.isArray(body.ordered_ids)
      ? body.ordered_ids
          .map((value: unknown) => String(value).trim())
          .filter(Boolean)
      : []

    if (orderedIds.length === 0) {
      return NextResponse.json(
        { error: 'ordered_ids must be a non-empty array' },
        { status: 400 },
      )
    }

    for (let index = 0; index < orderedIds.length; index += 1) {
      const id = orderedIds[index]
      const { error } = await supabase
        .from('service_catalog_items')
        .update({
          sort_order: index + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[ops/services/reorder][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to reorder services' },
      { status: 500 },
    )
  }
}
