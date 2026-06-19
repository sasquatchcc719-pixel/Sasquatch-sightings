import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  isAnalystFeatureEnabled,
  isAnalystHistoryReadonlyEnabled,
} from '@/lib/harry/features'

/**
 * Analyst (Radar) feature status. Standalone so the Analyst pages no longer
 * depend on the (removed) Harry control endpoint. Env-flag reads only.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    return NextResponse.json({
      analystEnabled: isAnalystFeatureEnabled(),
      historyReadonly: isAnalystHistoryReadonlyEnabled(),
    })
  } catch (error) {
    console.error('[admin/analyst/status][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load analyst status' },
      { status: 500 },
    )
  }
}
