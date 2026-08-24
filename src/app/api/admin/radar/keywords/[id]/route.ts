/**
 * Radar keyword: pause/edit/delete. Admin only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const body = (await request.json()) as {
    keyword?: string
    location?: string
    active?: boolean
  }
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (typeof body.keyword === 'string' && body.keyword.trim()) {
    patch.keyword = body.keyword.trim()
  }
  if (typeof body.location === 'string' && body.location.trim()) {
    patch.location = body.location.trim()
  }
  if (typeof body.active === 'boolean') patch.active = body.active
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('radar_keywords')
    .update(patch)
    .eq('id', id)
    .select('id, keyword, location, active')
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
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
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const { error } = await supabase.from('radar_keywords').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
