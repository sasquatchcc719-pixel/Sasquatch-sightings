import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  runRangerBulkAction,
  runRangerTelegramAction,
} from '@/lib/ranger/actions'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const body = (await request.json()) as {
      action?: string
      applicantId?: string
    }

    const supabase = createAdminClient()
    const result = body.applicantId
      ? await runRangerTelegramAction({
          supabase,
          action: body.action,
          applicantId: body.applicantId,
          actor: user.email,
        })
      : await runRangerBulkAction({
          supabase,
          action: body.action,
          actor: user.email,
        })

    return NextResponse.json({ ok: true, result })
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[admin/ranger/action] Error:', error)
    return NextResponse.json(
      { error: 'Failed to run Ranger action' },
      { status: 500 },
    )
  }
}
