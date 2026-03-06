/**
 * Radar domains: add (POST) and list (GET). Admin only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'

function normalizeDomainInput(domain: string): string {
  const s = domain.trim().toLowerCase()
  return s
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

export async function GET() {
  const { user, role } = await getUserWithRole()
  if (!user || role !== 'admin') {
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
  if (!user || role !== 'admin') {
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
  return NextResponse.json(data)
}
