import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadBusinessDecisionSnapshot } from '@/lib/ops/business-decisions'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const result = await loadBusinessDecisionSnapshot(createAdminClient())
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[business-decisions]', error)
    return NextResponse.json(
      { error: 'Could not load business decisions' },
      { status: 500 },
    )
  }
}
