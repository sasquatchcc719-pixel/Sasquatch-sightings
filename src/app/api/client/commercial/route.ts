import { NextRequest, NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadCommercialData } from '@/lib/ops/commercial-server'
import { commercialProfileSchema } from '@/lib/ops/commercial'
export async function GET() {
  try {
    const { client } = await requireClientManager()
    return NextResponse.json({
      ...(await loadCommercialData(createAdminClient(), client.customer_id)),
      canSign: client.can_sign_agreements === true,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Unable to load business details' },
      {
        status:
          e instanceof Error && e.message === 'Not a client manager'
            ? 403
            : 500,
      },
    )
  }
}
export async function PATCH(request: NextRequest) {
  try {
    const { user, client } = await requireClientManager()
    const fields = commercialProfileSchema
      .omit({ legal_name: true })
      .parse(await request.json())
    const db = createAdminClient()
    const { error } = await db.from('ops_commercial_profiles').upsert({
      ...fields,
      customer_id: client.customer_id,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: 'Unable to save business details' },
      {
        status:
          e instanceof Error && e.message === 'Not a client manager'
            ? 403
            : 400,
      },
    )
  }
}
