import { createAdminClient } from '@/supabase/server'
import { buildJobUrl } from '@/lib/google-indexing'
import { zapierExecute } from './zapier-mcp'
import type {
  Channel,
  DeliveryResult,
  EchoDraft,
  EchoJobContext,
  EchoSettings,
} from './types'

// The Sasquatch Carpet Cleaning Google Business Profile location (verified via
// the Zapier MCP location enum 2026-06-12). Override with GBP_LOCATION_ID.
const GBP_LOCATION =
  process.env.GBP_LOCATION_ID || 'locations/9600482684384871912'
// Facebook page id, set once the page becomes reachable (it currently lives in
// Meta Business Suite, which Zapier's Facebook integration cannot see).
const FB_PAGE_ID = process.env.ECHO_FACEBOOK_PAGE_ID

function buildPayload(draft: EchoDraft, job: EchoJobContext) {
  const service =
    job.line_item_names.filter(Boolean).join(', ') || job.service_name
  return {
    job_id: job.id,
    slug: job.slug,
    service,
    city: job.city,
    neighborhood: job.neighborhood,
    image_url: job.image_url,
    body: draft.body,
    target_url: buildJobUrl(job.city ?? 'Colorado', job.slug),
    style: draft.style,
  }
}

/** Post a job to the right channel via the user's Zapier MCP server. */
async function deliverToChannel(
  channel: Channel,
  draft: EchoDraft,
  job: EchoJobContext,
): Promise<{ ok: boolean; detail: string }> {
  const jobUrl = buildJobUrl(job.city ?? 'Colorado', job.slug)
  if (channel === 'google') {
    return zapierExecute(
      'GoogleMyBusinessCLIAPI',
      'create_post',
      {
        location: GBP_LOCATION,
        topic_type: 'STANDARD',
        post_summary: draft.body,
        call_to_action_type: 'LEARN_MORE',
        call_to_action_url: jobUrl,
        ...(job.image_url ? { photo_source_url: job.image_url } : {}),
      },
      'Create and publish this Google Business Profile post now. Every field is supplied — do not ask any follow-up questions.',
    )
  }
  // facebook
  if (!FB_PAGE_ID) {
    return {
      ok: false,
      detail:
        'ECHO_FACEBOOK_PAGE_ID not set (page not yet reachable via Zapier — Meta Business Suite)',
    }
  }
  return zapierExecute(
    'FacebookV2CLIAPI',
    'create_page_post',
    {
      page: FB_PAGE_ID,
      message: `${draft.body}\n\n${jobUrl}`,
      ...(job.image_url ? { source: job.image_url } : {}),
    },
    'Create and publish this Facebook page post now. Every field is supplied — do not ask any follow-up questions.',
  )
}

export async function fire(
  draft: EchoDraft,
  job: EchoJobContext,
  settings: EchoSettings,
): Promise<DeliveryResult[]> {
  const supabase = createAdminClient()
  const results: DeliveryResult[] = []
  const payload = buildPayload(draft, job)

  const channels: Channel[] = []
  if (settings.google_enabled) channels.push('google')
  if (settings.facebook_enabled) channels.push('facebook')

  for (const channel of channels) {
    // Idempotency: skip if we've already successfully posted this job on this channel
    const { data: existing } = await supabase
      .from('social_post_log')
      .select('id')
      .eq('job_id', job.id)
      .eq('channel', channel)
      .eq('status', 'success')
      .maybeSingle()

    if (existing) {
      results.push({
        channel,
        status: 'skipped',
        reason: 'Already posted successfully',
      })
      continue
    }

    if (!process.env.ZAPIER_MCP_URL) {
      await supabase.from('social_post_log').insert({
        job_id: job.id,
        draft_id: draft.id,
        channel,
        status: 'failed',
        reason: 'ZAPIER_MCP_URL not configured',
        request_payload: payload,
      })
      results.push({
        channel,
        status: 'failed',
        reason: 'ZAPIER_MCP_URL not configured',
      })
      continue
    }

    // Boundary validation
    if (!job.city || !payload.body || (payload.body as string).length > 1500) {
      await supabase.from('social_post_log').insert({
        job_id: job.id,
        draft_id: draft.id,
        channel,
        status: 'failed',
        reason:
          'Payload validation failed (city missing, body empty, or body > 1500 chars)',
        request_payload: payload,
      })
      results.push({
        channel,
        status: 'failed',
        reason: 'Payload validation failed',
      })
      continue
    }

    const result = await deliverToChannel(channel, draft, job)
    const status: DeliveryResult['status'] = result.ok ? 'success' : 'failed'
    await supabase.from('social_post_log').insert({
      job_id: job.id,
      draft_id: draft.id,
      channel,
      status,
      reason: result.ok ? null : result.detail.slice(0, 300),
      request_payload: payload,
      response: { detail: result.detail.slice(0, 1000) },
    })
    results.push({
      channel,
      status,
      reason: result.ok ? undefined : result.detail.slice(0, 200),
    })
  }

  // Update draft status based on aggregate results
  const anySuccess = results.some((r) => r.status === 'success')
  const allFailed =
    results.length > 0 && results.every((r) => r.status === 'failed')
  if (anySuccess) {
    await supabase
      .from('social_post_drafts')
      .update({
        status: 'posted',
        posted_at: new Date().toISOString(),
      })
      .eq('id', draft.id)
  } else if (allFailed) {
    await supabase
      .from('social_post_drafts')
      .update({ status: 'failed' })
      .eq('id', draft.id)
  }

  return results
}
