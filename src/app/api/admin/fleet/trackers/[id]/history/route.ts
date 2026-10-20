import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await context.params
  const start = request.nextUrl.searchParams.get('start')
  const end = request.nextUrl.searchParams.get('end')
  const startMs = Date.parse(start ?? '')
  const endMs = Date.parse(end ?? '')
  if (
    !z.uuid().safeParse(id).success ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs ||
    endMs - startMs > 25 * 3600_000
  )
    return NextResponse.json(
      { error: 'Choose a valid history day' },
      { status: 400 },
    )
  const { data, error } = await createAdminClient().rpc(
    'fleet_tracker_history',
    {
      p_tracker_id: id,
      p_start: new Date(startMs).toISOString(),
      p_end: new Date(endMs).toISOString(),
    },
  )
  if (error)
    return NextResponse.json(
      { error: 'Unable to load history' },
      { status: 503 },
    )
  return NextResponse.json(
    { points: data },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
