import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadSeoBriefing } from '@/lib/seo/briefing'
export const maxDuration = 60
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const report = await loadSeoBriefing(createAdminClient())
    return NextResponse.json(report, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Could not load SEO briefing'
    const forbidden =
      message === 'Not authorized' || /unauthor|forbidden|role/i.test(message)
    return NextResponse.json(
      { error: forbidden ? 'Not authorized' : 'Could not load SEO briefing' },
      { status: forbidden ? 403 : 500 },
    )
  }
}
