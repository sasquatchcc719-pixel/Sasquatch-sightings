/**
 * Mirror new Local Falcon scans into our tables.
 *
 * Reading reports costs no Local Falcon credits — only running a scan does —
 * so this can run often and cheaply. It does NOT trigger scans; those are
 * scheduled inside Local Falcon itself, which keeps credit spend in one place
 * rather than split across two systems that could each think they're in charge.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { syncLocalFalconScans } from '@/lib/ops/local-falcon-sync'

export const maxDuration = 120

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.LOCAL_FALCON_API_KEY) {
    // Not an error — the integration simply isn't configured yet.
    return NextResponse.json({ ok: true, skipped: 'no LOCAL_FALCON_API_KEY' })
  }

  try {
    const result = await syncLocalFalconScans(createAdminClient(), { limit: 50 })
    if (result.errors.length) {
      console.error('[cron/local-falcon-sync] partial failures', result.errors)
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync failed'
    console.error('[cron/local-falcon-sync]', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
