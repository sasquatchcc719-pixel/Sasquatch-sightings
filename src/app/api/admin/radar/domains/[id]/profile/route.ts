/**
 * Radar domain profile: get (via GET domain) or update. Admin only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || (role !== 'admin' && role !== 'owner')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: domainId } = await params
  if (!domainId) {
    return NextResponse.json({ error: 'domain id required' }, { status: 400 })
  }
  const body = (await request.json()) as {
    threat_level?: string | null
    business_model?: string | null
    primary_strength?: string | null
    core_weakness?: string | null
    sasquatch_counter_attack?: string | null
    threat_archetype?: string | null
  }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('radar_domain_profiles')
    .select('id')
    .eq('domain_id', domainId)
    .maybeSingle()

  const row = {
    domain_id: domainId,
    threat_level: body.threat_level ?? null,
    business_model: body.business_model ?? null,
    primary_strength: body.primary_strength ?? null,
    core_weakness: body.core_weakness ?? null,
    sasquatch_counter_attack: body.sasquatch_counter_attack ?? null,
    threat_archetype: body.threat_archetype ?? null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { data, error } = await supabase
      .from('radar_domain_profiles')
      .update(row)
      .eq('domain_id', domainId)
      .select()
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data)
  }

  const { data, error } = await supabase
    .from('radar_domain_profiles')
    .insert(row)
    .select()
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
