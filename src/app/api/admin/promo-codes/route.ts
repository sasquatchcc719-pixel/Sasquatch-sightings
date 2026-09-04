import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('promo_codes')
      .select(
        'id, code, discount_type, discount_amount, description, active, expires_at, max_uses, use_count, created_at',
      )
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ promo_codes: data })
  } catch (error) {
    console.error('[admin/promo-codes][GET]', error)
    return NextResponse.json(
      { error: 'Failed to load promo codes' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json()

    const code = String(body.code || '')
      .toUpperCase()
      .trim()
    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    const discountType = String(body.discount_type || 'flat')
    if (!['flat', 'percent'].includes(discountType)) {
      return NextResponse.json(
        { error: 'discount_type must be flat or percent' },
        { status: 400 },
      )
    }

    const discountAmount = Number(body.discount_amount)
    if (isNaN(discountAmount) || discountAmount <= 0) {
      return NextResponse.json(
        { error: 'discount_amount must be a positive number' },
        { status: 400 },
      )
    }

    if (discountType === 'percent' && discountAmount > 100) {
      return NextResponse.json(
        { error: 'Percent discount cannot exceed 100' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('promo_codes')
      .insert({
        code,
        discount_type: discountType,
        discount_amount: discountAmount,
        description: body.description ? String(body.description).trim() : null,
        active: body.active !== false,
        expires_at: body.expires_at || null,
        max_uses: body.max_uses ? Number(body.max_uses) : null,
        use_count: 0,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `Code "${code}" already exists` },
          { status: 409 },
        )
      }
      throw error
    }

    return NextResponse.json({ promo_code: data }, { status: 201 })
  } catch (error) {
    console.error('[admin/promo-codes][POST]', error)
    return NextResponse.json(
      { error: 'Failed to create promo code' },
      { status: 500 },
    )
  }
}
