import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { computePromoDiscountAmount } from '@/lib/promo-discount'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/**
 * Public read-only: compute discount for a subtotal (same rules as booking).
 * Used by NFC /tap booking widget review step to show line-item math before submit.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = request.nextUrl
    const code = String(searchParams.get('code') || '')
      .toUpperCase()
      .trim()
    const subtotal = Number(searchParams.get('subtotal') || 0)

    if (!code || !Number.isFinite(subtotal) || subtotal < 0) {
      return NextResponse.json(
        { error: 'code and a valid subtotal are required' },
        { status: 400, headers: CORS },
      )
    }

    const { data: promo, error } = await supabase
      .from('promo_codes')
      .select(
        'id, code, discount_type, discount_amount, expires_at, max_uses, use_count',
      )
      .eq('code', code)
      .eq('active', true)
      .maybeSingle()

    if (error) throw error

    if (!promo) {
      return NextResponse.json(
        {
          code,
          subtotal,
          discount_amount: 0,
          total: subtotal,
          applied: false,
        },
        { headers: CORS },
      )
    }

    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return NextResponse.json(
        {
          code,
          subtotal,
          discount_amount: 0,
          total: subtotal,
          applied: false,
          reason: 'expired',
        },
        { headers: CORS },
      )
    }
    if (promo.max_uses !== null && promo.use_count >= promo.max_uses) {
      return NextResponse.json(
        {
          code,
          subtotal,
          discount_amount: 0,
          total: subtotal,
          applied: false,
          reason: 'max_uses',
        },
        { headers: CORS },
      )
    }

    const discount_amount = computePromoDiscountAmount(
      subtotal,
      String(promo.discount_type),
      Number(promo.discount_amount),
    )
    const total = Math.max(0, subtotal - discount_amount)

    return NextResponse.json(
      {
        code: promo.code,
        subtotal,
        discount_type: promo.discount_type,
        discount_amount,
        total,
        applied: true,
      },
      { headers: CORS },
    )
  } catch (e) {
    console.error('[public/promo-preview]', e)
    return NextResponse.json(
      { error: 'Failed to preview promo' },
      { status: 500, headers: CORS },
    )
  }
}
