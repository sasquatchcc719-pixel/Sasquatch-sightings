import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

/**
 * Daily cron: rebuild the marketing site when new jobs were published.
 *
 * The website prerenders each area page with its "Recent Work" job links
 * baked into the HTML, so newly published jobs only reach those pages on the
 * next website deploy. This triggers that deploy through a Vercel deploy hook
 * (WEBSITE_DEPLOY_HOOK_URL, created on the sasquatch-com-client project) —
 * at most once a day, and only when there is something new to show.
 */
const WINDOW_HOURS = 25 // cron runs daily; overlap by an hour so nothing slips between runs

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hookUrl = process.env.WEBSITE_DEPLOY_HOOK_URL
  if (!hookUrl) {
    console.warn('[website-rebuild] WEBSITE_DEPLOY_HOOK_URL not set; skipping')
    return NextResponse.json({
      triggered: false,
      reason: 'hook_not_configured',
    })
  }

  try {
    const supabase = createAdminClient()
    const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000)

    const { count, error } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .gte('published_at', since.toISOString())

    if (error) throw error

    if (!count) {
      return NextResponse.json({ triggered: false, reason: 'no_new_jobs' })
    }

    const res = await fetch(hookUrl, { method: 'POST' })
    if (!res.ok) {
      throw new Error(`Deploy hook returned ${res.status}`)
    }

    console.log(
      `[website-rebuild] Triggered website deploy for ${count} new job(s)`,
    )
    return NextResponse.json({ triggered: true, newJobs: count })
  } catch (err) {
    console.error('[website-rebuild] Failed:', err)
    return NextResponse.json(
      { error: 'Failed to trigger website rebuild' },
      { status: 500 },
    )
  }
}
