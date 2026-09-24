import { NextRequest, NextResponse } from 'next/server'
import {
  buildBusinessCostDigest,
  loadBusinessCostSnapshots,
  refreshBusinessCostSnapshots,
  rollingCostWindowsSince,
} from '@/lib/ops/business-economics'
import { sendTelegramNotification } from '@/lib/telegram'
import { createAdminClient } from '@/supabase/server'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const windows = rollingCostWindowsSince().slice(-8)
    const refreshed = await refreshBusinessCostSnapshots(supabase, windows)
    const snapshots = await loadBusinessCostSnapshots(supabase)
    const sent = await sendTelegramNotification(
      buildBusinessCostDigest(snapshots),
      { disablePreview: true },
    )
    if (!sent) {
      return NextResponse.json(
        { error: 'Cost report built, but Telegram delivery failed' },
        { status: 502 },
      )
    }
    return NextResponse.json({
      ok: true,
      refreshed: refreshed.length,
      latestWindow: refreshed.at(-1)?.windowEnd || null,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Business cost report failed'
    console.error('[cron/business-cost-report]', error)
    await sendTelegramNotification(
      `Business Cost Report FAILED — no cost update this week.\nError: ${message}`,
      { disablePreview: true },
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
