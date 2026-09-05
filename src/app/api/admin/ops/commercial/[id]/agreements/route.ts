import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  contentFromEstimate,
  loadCommercialData,
} from '@/lib/ops/commercial-server'
import { newAgreementContent } from '@/lib/ops/commercial'
import { z } from 'zod'
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAnyRole(['admin', 'owner'])
    const { id } = await params
    const body = z
      .object({ estimate_id: z.uuid().optional() })
      .parse(await request.json())
    const db = createAdminClient()
    const commercial = await loadCommercialData(db, id, true)
    const content = body.estimate_id
      ? await contentFromEstimate(db, id, body.estimate_id)
      : newAgreementContent(
          commercial.profile.legal_name || commercial.businessName,
        )
    const { data, error } = await db
      .from('ops_commercial_agreements')
      .insert({
        customer_id: id,
        source_estimate_id: body.estimate_id || null,
        content,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to create draft' },
      {
        status:
          e instanceof Error && e.message === 'Not authorized' ? 403 : 400,
      },
    )
  }
}
