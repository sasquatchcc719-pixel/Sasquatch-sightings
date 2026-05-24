/**
 * Manual Radar SERP refresh. Admin only.
 * Runs the same scan as the cron and returns the result.
 */

import { NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { runRadarScan } from '@/lib/radar-scan'

export async function POST() {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runRadarScan()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
