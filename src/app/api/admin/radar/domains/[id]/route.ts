/**
 * Radar domain: get by id (with profile), delete. Admin only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const { data: domain, error: domError } = await supabase
    .from('radar_domains')
    .select('id, domain, display_name, is_my_domain')
    .eq('id', id)
    .single()
  if (domError || !domain) {
    return NextResponse.json(
      { error: domError?.message ?? 'Not found' },
      { status: domError?.code === 'PGRST116' ? 404 : 500 },
    )
  }
  const { data: profile } = await supabase
    .from('radar_domain_profiles')
    .select(
      'threat_level, business_model, primary_strength, core_weakness, sasquatch_counter_attack, threat_archetype, updated_at',
    )
    .eq('domain_id', id)
    .maybeSingle()
  return NextResponse.json({
    domain: {
      id: domain.id,
      domain: domain.domain,
      display_name: domain.display_name,
      is_my_domain: domain.is_my_domain,
    },
    profile: profile ?? null,
  })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role } = await getUserWithRole()
  if (!user || role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const { error } = await supabase.from('radar_domains').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
