import { createAdminClient } from '@/supabase/server'
import type { Decision, EchoJobContext, EchoSettings } from './types'

export async function decide(
  job: EchoJobContext,
  settings: EchoSettings,
): Promise<Decision> {
  if (!settings.enabled) {
    return { action: 'skip', reason: 'Echo is disabled' }
  }
  if (
    !job.city ||
    job.city.toLowerCase() === 'unknown' ||
    job.city.trim() === ''
  ) {
    return { action: 'skip', reason: 'No valid city on job' }
  }
  if (!job.image_url) {
    return { action: 'skip', reason: 'No image on job' }
  }
  if (!settings.google_enabled && !settings.facebook_enabled) {
    return { action: 'skip', reason: 'All channels disabled' }
  }

  const supabase = createAdminClient()

  // Skip rule: same city posted recently (within skip_repeat_days)
  const cutoffMs = Date.now() - settings.skip_repeat_days * 86400000
  const cutoffIso = new Date(cutoffMs).toISOString()
  const { data: recent } = await supabase
    .from('social_post_drafts')
    .select('context_data, posted_at')
    .eq('status', 'posted')
    .gte('posted_at', cutoffIso)

  const cityLower = job.city.toLowerCase()
  const matchesRecentCity = (recent ?? []).some((r) => {
    const ctx = (r as { context_data: Record<string, unknown> | null })
      .context_data
    if (!ctx) return false
    const ctxCity = ctx.city
    return typeof ctxCity === 'string' && ctxCity.toLowerCase() === cityLower
  })
  if (matchesRecentCity) {
    return {
      action: 'map_only',
      reason: `Already posted in ${job.city} within last ${settings.skip_repeat_days} days`,
    }
  }

  // Weekly cap — current ISO week, posted drafts only
  const weekStart = new Date()
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay())
  weekStart.setUTCHours(0, 0, 0, 0)
  const { count: weekPostedCount } = await supabase
    .from('social_post_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'posted')
    .gte('posted_at', weekStart.toISOString())

  if ((weekPostedCount ?? 0) >= settings.weekly_cap) {
    return {
      action: 'map_only',
      reason: `Weekly cap of ${settings.weekly_cap} already reached`,
    }
  }

  return {
    action: settings.auto_post ? 'auto_post' : 'draft',
    reason: settings.auto_post
      ? 'Auto-post enabled and all checks passed'
      : 'Drafted for approval',
  }
}
