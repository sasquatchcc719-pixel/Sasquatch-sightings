/**
 * Mirror Local Falcon products into our tables (scans, trends, competitors,
 * campaigns, Guard, reviews, account). Reading is free — only run-scan spends.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { syncAllLocalFalcon } from '@/lib/ops/local-falcon-sync'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.LOCAL_FALCON_API_KEY) {
    return NextResponse.json({ ok: true, skipped: 'no LOCAL_FALCON_API_KEY' })
  }

  try {
    const result = await syncAllLocalFalcon(createAdminClient(), {
      limit: 50,
      upgradeExisting: true,
    })
    const errors = [
      ...result.scans.errors,
      ...result.competitors.errors,
      ...result.trends.errors,
      ...result.locations.errors,
      ...result.keywords.errors,
      ...result.campaigns.errors,
      ...result.guard.errors,
      ...result.reviews.errors,
      ...(result.account.error ? [result.account.error] : []),
    ]
    if (errors.length) {
      console.error('[cron/local-falcon-sync] partial failures', errors)
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync failed'
    console.error('[cron/local-falcon-sync]', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
