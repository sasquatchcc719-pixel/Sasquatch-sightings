import { NextRequest, NextResponse } from 'next/server'
import { isNextdoorCode, nextdoorDiscount } from '@/lib/nextdoor-promo'
import { createAdminClient } from '@/supabase/server'
import {
  computePromoDiscountAmount,
  computeTieredDiscountAmount,
} from '@/lib/promo-discount'
import { validateTomorrowFillPromoToken } from '@/lib/ops/tomorrow-fill'

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
    const tomorrowFillToken = String(
      searchParams.get('tomorrow_fill_token') || '',
    ).trim()

    if (!code || !Number.isFinite(subtotal) || subtotal < 0) {
      return NextResponse.json(
        { error: 'code and a valid subtotal are required' },
        { status: 400, headers: CORS },
      )
    }

    let privateOfferAmount: number | undefined
    let minimumSubtotal: number | undefined
    if (code === 'TF35') {
      const offer = await validateTomorrowFillPromoToken(tomorrowFillToken)
      if (!offer || offer.offerCode !== code) {
        return NextResponse.json(
          { error: 'This private offer is no longer available.' },
          { status: 409, headers: CORS },
        )
      }
      minimumSubtotal = offer.minimumSubtotal
      privateOfferAmount = offer.offerAmount
      if (subtotal < minimumSubtotal) {
        return NextResponse.json(
          {
            code,
            subtotal,
            discount_amount: 0,
            total: subtotal,
            applied: false,
            reason: 'minimum_subtotal',
            minimum_subtotal: minimumSubtotal,
          },
          { headers: CORS },
        )
      }
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

    if (isNextdoorCode(code)) {
      const services = Number(searchParams.get('service_subtotal'))
      if (
        !searchParams.has('service_subtotal') ||
        !Number.isFinite(services) ||
        services < 0 ||
        services > subtotal
      )
        return NextResponse.json(
          {
            error:
              'A valid service_subtotal excluding travel, fees and tax is required.',
          },
          { status: 400, headers: CORS },
        )
      const discount = nextdoorDiscount(services)
      return NextResponse.json(
        {
          code,
          subtotal,
          service_subtotal: services,
          discount_amount: discount,
          total: Math.round((subtotal - discount) * 100) / 100,
          applied: discount > 0,
          minimum_subtotal: 300,
          stacking: false,
          ...(discount ? {} : { reason: 'minimum_subtotal' }),
        },
        { headers: CORS },
      )
    }

    let discount_amount: number
    if (privateOfferAmount !== undefined) {
      discount_amount = privateOfferAmount
    } else if (promo.discount_type === 'tiered') {
      const { data: tiers } = await supabase
        .from('promo_code_tiers')
        .select('min_spend, discount_amount')
        .eq('promo_code_id', promo.id)
      discount_amount = computeTieredDiscountAmount(
        subtotal,
        (tiers || []).map((t) => ({
          min_spend: Number(t.min_spend),
          discount_amount: Number(t.discount_amount),
        })),
      )
    } else {
      discount_amount = computePromoDiscountAmount(
        subtotal,
        String(promo.discount_type),
        Number(promo.discount_amount),
      )
    }
    const total = Math.max(0, subtotal - discount_amount)

    return NextResponse.json(
      {
        code: promo.code,
        subtotal,
        discount_type: promo.discount_type,
        discount_amount,
        total,
        applied: true,
        minimum_subtotal: minimumSubtotal,
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
