/**
 * Generate competitor dossiers via deep-dive + AI. Admin only.
 * POST body: { domain_id?: string } — if domain_id, run for that domain only; else run for all domains missing a profile.
 * Returns { generated: number, failed: number, errors?: string[] }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { gatherDossierContext } from '@/lib/radar-dossier-gather'
import { generateDossierFromContext } from '@/lib/radar-dossier-ai'
import { getRadarSummaryForDomain } from '@/lib/radar-dossier-summary'

const DELAY_BETWEEN_DOMAINS_MS = 2500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  const { user, role } = await getUserWithRole()
  if (!user || role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let targetDomainId: string | null = null
  try {
    const body = await request.json().catch(() => ({}))
    targetDomainId = (body as { domain_id?: string }).domain_id ?? null
  } catch {
    // empty body is ok
  }

  const supabase = createAdminClient()

  let domainRows: { id: string; domain: string; display_name: string | null }[]
  if (targetDomainId) {
    const { data, error } = await supabase
      .from('radar_domains')
      .select('id, domain, display_name')
      .eq('id', targetDomainId)
      .limit(1)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    domainRows = data ?? []
  } else {
    const { data: domains } = await supabase
      .from('radar_domains')
      .select('id, domain, display_name')
      .order('domain')
    const { data: existingProfiles } = await supabase
      .from('radar_domain_profiles')
      .select('domain_id')
    const profileIds = new Set(
      (existingProfiles ?? []).map((p: { domain_id: string }) => p.domain_id),
    )
    domainRows = (domains ?? []).filter((d) => !profileIds.has(d.id))
  }

  let generated = 0
  const errors: string[] = []

  for (let i = 0; i < domainRows.length; i++) {
    const d = domainRows[i]
    if (i > 0) await sleep(DELAY_BETWEEN_DOMAINS_MS)

    try {
      const radarSummary = await getRadarSummaryForDomain(
        supabase,
        d.id,
        d.domain,
      )
      const { combined } = await gatherDossierContext(
        d.domain,
        d.display_name,
        radarSummary,
      )
      const profile = await generateDossierFromContext(
        d.domain,
        d.display_name,
        combined,
      )

      const { error } = await supabase.from('radar_domain_profiles').upsert(
        {
          domain_id: d.id,
          threat_level: profile.threat_level,
          business_model: profile.business_model,
          primary_strength: profile.primary_strength,
          core_weakness: profile.core_weakness,
          sasquatch_counter_attack: profile.sasquatch_counter_attack,
          threat_archetype: profile.threat_archetype,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'domain_id' },
      )

      if (error) throw new Error(error.message)
      generated++
    } catch (e) {
      const msg = `${d.domain}: ${e instanceof Error ? e.message : String(e)}`
      errors.push(msg)
    }
  }

  return NextResponse.json({
    generated,
    failed: errors.length,
    ...(errors.length > 0 && { errors }),
  })
}
