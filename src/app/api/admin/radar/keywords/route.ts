/**
 * Radar keywords: add (POST) and list (GET).
 * Admin only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'

export async function GET() {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location, active')
    .eq('active', true)
    .order('keyword')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json()
  const { keyword, location } = body as { keyword?: string; location?: string }
  if (!keyword?.trim() || !location?.trim()) {
    return NextResponse.json(
      { error: 'keyword and location are required' },
      { status: 400 },
    )
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('radar_keywords')
    .insert({
      keyword: keyword.trim(),
      location: location.trim(),
      active: true,
    })
    .select('id, keyword, location')
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
