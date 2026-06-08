import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CANONICAL_LEAD_SOURCE_OPTIONS,
  LeadSourceOption,
  LeadSourceKey,
  NormalizedLeadSource,
  getLeadSourceOption,
  isLeadSourceKey,
  normalizeLeadSource,
  optionFromDatabaseRow,
  validateLeadSourceDetail,
} from '@/lib/lead-sources'

export async function getLeadSourceOptions(
  supabase: SupabaseClient,
  filters: { publicOnly?: boolean; activeOnly?: boolean } = {},
): Promise<LeadSourceOption[]> {
  let query = supabase
    .from('lead_source_options')
    .select(
      'source_key, customer_label, internal_label, reporting_category, display_order, is_active, is_public, requires_detail, detail_label',
    )
    .order('display_order', { ascending: true })

  if (filters.activeOnly !== false) query = query.eq('is_active', true)
  if (filters.publicOnly) query = query.eq('is_public', true)

  const { data, error } = await query
  if (error) {
    console.warn('[lead-sources] using fallback options:', error.message)
    return CANONICAL_LEAD_SOURCE_OPTIONS.filter((option) => {
      if (filters.activeOnly !== false && !option.is_active) return false
      if (filters.publicOnly && !option.is_public) return false
      return true
    })
  }

  const options = (data || [])
    .map((row) => optionFromDatabaseRow(row as Record<string, unknown>))
    .filter((option): option is LeadSourceOption => Boolean(option))

  return options.length > 0 ? options : CANONICAL_LEAD_SOURCE_OPTIONS
}

export async function normalizeLeadSourceForWrite(params: {
  supabase: SupabaseClient
  sourceKey?: string | null
  legacyValue?: string | null
  detail?: string | null
  requireActive?: boolean
  requirePublic?: boolean
  allowMissingDetail?: boolean
}): Promise<
  { ok: true; source: NormalizedLeadSource } | { ok: false; error: string }
> {
  const options = await getLeadSourceOptions(params.supabase, {
    activeOnly: params.requireActive !== false,
    publicOnly: params.requirePublic === true,
  })
  const byKey = new Map(options.map((option) => [option.source_key, option]))
  const rawKey = String(params.sourceKey || '').trim()
  const rawLegacy = String(params.legacyValue || '').trim()
  const input = rawKey || rawLegacy

  if (!input) {
    return { ok: false, error: 'Please let us know how you heard about us' }
  }

  const normalized = isLeadSourceKey(rawKey)
    ? normalizeLeadSource(rawKey, params.detail)
    : normalizeLeadSource(rawLegacy || rawKey, params.detail)

  const option = byKey.get(normalized.source_key)
  if (!option) {
    return { ok: false, error: 'Please choose a valid lead source' }
  }

  const source: NormalizedLeadSource = {
    ...normalized,
    source_key: option.source_key as LeadSourceKey,
    customer_label: option.customer_label,
    internal_label: option.internal_label,
    reporting_category: option.reporting_category,
    lead_source: option.customer_label,
    requires_detail: option.requires_detail,
    detail_label: option.detail_label,
    lead_source_detail: normalized.lead_source_detail,
    original_lead_source:
      normalized.original_lead_source ||
      (rawLegacy && rawLegacy !== option.customer_label ? rawLegacy : null),
  }

  const detailError =
    params.allowMissingDetail === true ? null : validateLeadSourceDetail(source)
  if (detailError) return { ok: false, error: detailError }

  if (source.is_self_attribution) {
    return {
      ok: false,
      error:
        'Lead source must be where the customer heard about Sasquatch, not the booking channel.',
    }
  }

  return { ok: true, source }
}

export function leadSourceUpdatePayload(source: NormalizedLeadSource) {
  return {
    lead_source: source.lead_source,
    lead_source_key: source.source_key,
    lead_source_detail: source.lead_source_detail,
    original_lead_source: source.original_lead_source,
  }
}

export function fallbackLeadSourcePayload(value: string | null | undefined) {
  const source = normalizeLeadSource(value)
  const option = getLeadSourceOption(source.source_key)
  return {
    lead_source: option.customer_label,
    lead_source_key: option.source_key,
    lead_source_detail: source.lead_source_detail,
    original_lead_source: source.original_lead_source,
  }
}
