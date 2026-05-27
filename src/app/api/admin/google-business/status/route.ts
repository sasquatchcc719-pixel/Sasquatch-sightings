import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getGoogleBusinessConfigStatus } from '@/lib/google-business'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const config = getGoogleBusinessConfigStatus()

    return NextResponse.json({
      ok: true,
      ready: config.ready,
      hasPinnedTarget: config.hasPinnedTarget,
      config,
      nextStep: config.ready
        ? config.hasPinnedTarget
          ? 'Google Business Profile posting has OAuth credentials and a pinned account/location target.'
          : 'OAuth credentials exist. Add GOOGLE_ACCOUNT_ID and GOOGLE_LOCATION_ID to pin the exact business profile target.'
        : 'Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN for direct Google Business Profile posting.',
    })
  } catch (err) {
    console.error('[google-business/status]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to check status' },
      { status: 500 },
    )
  }
}
