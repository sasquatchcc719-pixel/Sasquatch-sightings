import { NextRequest, NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { AGREEMENT_SELECT } from '@/lib/ops/commercial-server'
import { commercialDocument } from '@/lib/ops/commercial-document'
import type { CommercialAgreement } from '@/lib/ops/commercial'
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, role, client } = await getUserWithRole()
  const staff = role === 'admin' || role === 'owner'
  if (!user || (!staff && (!client || role !== 'client_manager')))
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { id } = await params
  let query = createAdminClient()
    .from('ops_commercial_agreements')
    .select(AGREEMENT_SELECT)
    .eq('id', id)
  if (!staff)
    query = query.eq('customer_id', client!.customer_id).neq('status', 'draft')
  const { data, error } = await query.maybeSingle()
  if (error)
    return NextResponse.json(
      { error: 'Unable to load agreement' },
      { status: 500 },
    )
  if (!data)
    return NextResponse.json({ error: 'Agreement not found' }, { status: 404 })
  return new Response(commercialDocument(data as CommercialAgreement), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="commercial-agreement-v${data.version}.html"`,
    },
  })
}
