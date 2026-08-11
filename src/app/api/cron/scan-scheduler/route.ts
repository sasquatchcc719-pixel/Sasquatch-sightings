/**
 * Daily scheduler: fires whichever rank scans are due per scan_schedules.
 *
 * Replaces the hardcoded-monthly /api/cron/radar-grid entry. Frequency now
 * lives in the database and is edited from the Radar page, so changing "weekly"
 * to "every 3 days" is a click, not a deploy.
 *
 * Runs daily at 13:00 UTC (6-7am MT) but only actually scans when a row is
 * due — a daily no-op check costs nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { runDueScans } from '@/lib/ops/scan-scheduler'
import { sendTelegramNotification } from '@/lib/telegram'

// A dense service-area grid is ~141 live calls at ~14s each, run 8-wide
// (see radar-grid.ts) ≈ 4 minutes. 300s is the safe ceiling across Vercel
// plans; the concurrency pool exists precisely so this fits inside it.
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runDueScans(createAdminClient())
    if (Object.keys(result.errors).length) {
      console.error('[cron/scan-scheduler] errors', result.errors)
    }

    // Telegram only when something happened — a daily "nothing due" ping
    // would train Charles to ignore the channel.
    if (result.fired.length || Object.keys(result.errors).length) {
      const lines = [
        '🛰️ Rank scans',
        ...result.fired.map((t) => `✅ ${t} fired`),
        ...Object.entries(result.errors).map(([t, e]) => `❌ ${t}: ${e.slice(0, 120)}`),
      ]
      try {
        await sendTelegramNotification(lines.join('\n'))
      } catch (err) {
        console.error('[cron/scan-scheduler] telegram failed', err)
      }
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'scheduler failed'
    console.error('[cron/scan-scheduler]', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
