import { createAdminClient } from '@/supabase/server'
import type {
  Channel,
  DeliveryResult,
  EchoDraft,
  EchoJobContext,
  EchoSettings,
} from './types'

const MAX_RETRIES = 3
const RETRY_BASE_MS = 500

const PUBLIC_BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sightings.sasquatchcarpet.com'

async function fireWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: string }> {
  let lastErr = ''
  let lastStatus = 0
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.text()
      lastStatus = res.status
      if (res.ok) return { ok: true, status: res.status, body }
      // 4xx is permanent — don't retry
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, body }
      }
      lastErr = body
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt))
    }
  }
  return { ok: false, status: lastStatus, body: lastErr || 'Network error' }
}

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
    target_url: `${PUBLIC_BASE_URL}/jobs/${job.slug}`,
    style: draft.style,
  }
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

    const envKey =
      channel === 'google'
        ? 'ZAPIER_GOOGLE_WEBHOOK_URL'
        : 'ZAPIER_FACEBOOK_WEBHOOK_URL'
    const webhookUrl = process.env[envKey]
    if (!webhookUrl) {
      await supabase.from('social_post_log').insert({
        job_id: job.id,
        draft_id: draft.id,
        channel,
        status: 'failed',
        reason: `${envKey} not configured`,
        request_payload: payload,
      })
      results.push({
        channel,
        status: 'failed',
        reason: `${envKey} not configured`,
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

    const result = await fireWebhook(webhookUrl, payload)
    const status: DeliveryResult['status'] = result.ok ? 'success' : 'failed'
    await supabase.from('social_post_log').insert({
      job_id: job.id,
      draft_id: draft.id,
      channel,
      status,
      reason: result.ok
        ? null
        : `HTTP ${result.status}: ${result.body.slice(0, 300)}`,
      request_payload: payload,
      response: { status: result.status, body: result.body.slice(0, 1000) },
    })
    results.push({
      channel,
      status,
      reason: result.ok
        ? undefined
        : `HTTP ${result.status}: ${result.body.slice(0, 200)}`,
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
