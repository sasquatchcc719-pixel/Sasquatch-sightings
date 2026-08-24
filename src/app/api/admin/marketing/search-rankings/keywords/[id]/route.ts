/**
 * Pause (PATCH active) or drop (DELETE) a watchlist keyword.
 *
 * Deleting the keyword leaves its gsc_keyword_snapshots history in place, so
 * re-adding it later restores the trend immediately instead of re-querying
 * Google for weeks it already has.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const body = await request.json()

    if (typeof body.active !== 'boolean') {
      return NextResponse.json(
        { error: 'active must be true or false' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('gsc_watchlist_keywords')
      .update({ active: body.active })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ keyword: data })
  } catch (err) {
    console.error('[admin/search-rankings/keywords/:id][PATCH]', err)
    return NextResponse.json(
      { error: 'Failed to update keyword' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { id } = await params

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('gsc_watchlist_keywords')
      .delete()
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[admin/search-rankings/keywords/:id][DELETE]', err)
    return NextResponse.json(
      { error: 'Failed to remove keyword' },
      { status: 500 },
    )
  }
}
