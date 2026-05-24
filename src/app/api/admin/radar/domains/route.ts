/**
 * Radar domains: add (POST) and list (GET). Admin only.
 * POST runs deep-dive gather + AI dossier generation for the new domain.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { gatherDossierContext } from '@/lib/radar-dossier-gather'
import { generateDossierFromContext } from '@/lib/radar-dossier-ai'
import { getRadarSummaryForDomain } from '@/lib/radar-dossier-summary'

function normalizeDomainInput(domain: string): string {
  const s = domain.trim().toLowerCase()
  return s
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

export async function GET() {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('radar_domains')
    .select('id, domain, display_name, is_my_domain')
    .order('domain')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json()
  const { domain, display_name, is_my_domain } = body as {
    domain?: string
    display_name?: string
    is_my_domain?: boolean
  }
  if (!domain?.trim()) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }
  const normalized = normalizeDomainInput(domain)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('radar_domains')
    .insert({
      domain: normalized,
      display_name: display_name?.trim() || null,
      is_my_domain: Boolean(is_my_domain),
    })
    .select('id, domain, display_name, is_my_domain')
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  try {
    const radarSummary = await getRadarSummaryForDomain(
      supabase,
      data.id,
      data.domain,
    )
    const { combined } = await gatherDossierContext(
      data.domain,
      data.display_name,
      radarSummary,
    )
    const profile = await generateDossierFromContext(
      data.domain,
      data.display_name,
      combined,
    )
    await supabase.from('radar_domain_profiles').insert({
      domain_id: data.id,
      threat_level: profile.threat_level,
      business_model: profile.business_model,
      primary_strength: profile.primary_strength,
      core_weakness: profile.core_weakness,
      sasquatch_counter_attack: profile.sasquatch_counter_attack,
      threat_archetype: profile.threat_archetype,
    })
  } catch (err) {
    console.error('[Radar] Dossier generation for new domain failed:', err)
  }

  return NextResponse.json(data)
}
