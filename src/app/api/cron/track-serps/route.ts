/**
 * Radar SERP tracking cron job.
 * Schedule in vercel.json. Requires CRON_SECRET and SERPAPI_API_KEY.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runRadarScan } from '@/lib/radar-scan'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runRadarScan()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[Radar Cron] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 },
    )
  }
}
