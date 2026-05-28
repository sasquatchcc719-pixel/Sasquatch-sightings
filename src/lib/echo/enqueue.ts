import { createAdminClient } from '@/supabase/server'
import { getSettings } from './settings'
import { decide } from './decide'
import { generatePostBody, pickStyle } from './generator'
import { fire } from './delivery'
import type { EchoDraft, EchoJobContext } from './types'

async function loadJobContext(jobId: string): Promise<EchoJobContext | null> {
  const supabase = createAdminClient()
  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      `id, slug, city, neighborhood, image_url, ai_description, published_at, ops_invoice_id,
       service:services(name)`,
    )
    .eq('id', jobId)
    .single()
  if (error || !job) return null

  let lineItemNames: string[] = []
  const invoiceId = (job as { ops_invoice_id?: string | null }).ops_invoice_id
  if (invoiceId) {
    const { data: invoice } = await supabase
      .from('ops_invoices')
      .select(
        `ops_appointments ( ops_appointment_line_items ( name_snapshot ) )`,
      )
      .eq('id', invoiceId)
      .maybeSingle()
    const appt = Array.isArray(invoice?.ops_appointments)
      ? invoice?.ops_appointments[0]
      : invoice?.ops_appointments
    const rawLines = Array.isArray(
      (appt as { ops_appointment_line_items?: unknown })
        ?.ops_appointment_line_items,
    )
      ? (appt as { ops_appointment_line_items: { name_snapshot?: string }[] })
          .ops_appointment_line_items
      : []
    lineItemNames = rawLines
      .map((li) => String(li.name_snapshot ?? '').trim())
      .filter(Boolean)
  }

  const rawService = (
    job as { service?: { name: string } | { name: string }[] | null }
  ).service
  const service = Array.isArray(rawService) ? rawService[0] : rawService
  return {
    id: (job as { id: string }).id,
    slug: (job as { slug: string }).slug,
    city: (job as { city: string | null }).city,
    neighborhood: (job as { neighborhood: string | null }).neighborhood,
    service_name: service?.name ?? 'Carpet Cleaning',
    line_item_names: lineItemNames,
    image_url: (job as { image_url: string | null }).image_url,
    ai_description: (job as { ai_description: string | null }).ai_description,
    published_at: (job as { published_at: string | null }).published_at,
  }
}

export type EnqueueResult = {
  action: 'auto_post' | 'draft' | 'map_only' | 'skip'
  reason: string
  draftId?: string
  delivery?: { channel: string; status: string; reason?: string }[]
}

export async function enqueue(jobId: string): Promise<EnqueueResult> {
  const supabase = createAdminClient()
  const settings = await getSettings()

  const job = await loadJobContext(jobId)
  if (!job) return { action: 'skip', reason: 'Job not found' }

  const decision = await decide(job, settings)

  if (decision.action === 'skip') {
    return { action: 'skip', reason: decision.reason }
  }

  if (decision.action === 'map_only') {
    await supabase.from('social_post_drafts').insert({
      job_id: job.id,
      post_type: 'recent_work',
      body: job.ai_description ?? `Job in ${job.city ?? 'area'}`,
      image_url: job.image_url,
      status: 'map_only',
      skip_reason: decision.reason,
      context_data: {
        city: job.city,
        neighborhood: job.neighborhood,
        service: job.service_name,
      },
    })
    return { action: 'map_only', reason: decision.reason }
  }

  // draft or auto_post — generate the body
  const style = await pickStyle()
  const { body } = await generatePostBody(job, style)

  const initialStatus = decision.action === 'auto_post' ? 'approved' : 'draft'

  const { data: draftRow, error: draftErr } = await supabase
    .from('social_post_drafts')
    .insert({
      job_id: job.id,
      post_type: 'recent_work',
      body,
      image_url: job.image_url,
      status: initialStatus,
      style,
      context_data: {
        city: job.city,
        neighborhood: job.neighborhood,
        service: job.service_name,
      },
    })
    .select('*')
    .single()

  if (draftErr || !draftRow) {
    return {
      action: 'skip',
      reason: `Failed to write draft: ${draftErr?.message ?? 'unknown'}`,
    }
  }

  if (decision.action === 'auto_post') {
    const delivery = await fire(draftRow as EchoDraft, job, settings)
    return {
      action: 'auto_post',
      reason: decision.reason,
      draftId: (draftRow as { id: string }).id,
      delivery: delivery.map((d) => ({
        channel: d.channel,
        status: d.status,
        reason: d.reason,
      })),
    }
  }

  return {
    action: 'draft',
    reason: decision.reason,
    draftId: (draftRow as { id: string }).id,
  }
}

export async function approveDraft(draftId: string) {
  const supabase = createAdminClient()
  const { data: draft, error: draftErr } = await supabase
    .from('social_post_drafts')
    .select('*')
    .eq('id', draftId)
    .single()
  if (draftErr || !draft) {
    throw new Error(`Draft not found: ${draftErr?.message ?? 'no row'}`)
  }
  const typedDraft = draft as EchoDraft
  if (!typedDraft.job_id) {
    throw new Error('Draft has no associated job — cannot deliver')
  }
  const job = await loadJobContext(typedDraft.job_id)
  if (!job) throw new Error('Associated job not found')
  const settings = await getSettings()
  return fire(typedDraft, job, settings)
}
