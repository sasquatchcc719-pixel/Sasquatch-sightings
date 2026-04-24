import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (body.active !== undefined) updates.active = Boolean(body.active)
    if (body.description !== undefined)
      updates.description = body.description
        ? String(body.description).trim()
        : null
    if (body.expires_at !== undefined)
      updates.expires_at = body.expires_at || null
    if (body.max_uses !== undefined)
      updates.max_uses = body.max_uses !== null ? Number(body.max_uses) : null
    if (body.discount_amount !== undefined)
      updates.discount_amount = Number(body.discount_amount)
    if (body.discount_type !== undefined)
      updates.discount_type = String(body.discount_type)

    const { data, error } = await supabase
      .from('promo_codes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ promo_code: data })
  } catch (error) {
    console.error('[admin/promo-codes/:id][PATCH]', error)
    return NextResponse.json(
      { error: 'Failed to update promo code' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const { id } = await params

    const { error } = await supabase.from('promo_codes').delete().eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/promo-codes/:id][DELETE]', error)
    return NextResponse.json(
      { error: 'Failed to delete promo code' },
      { status: 500 },
    )
  }
}
