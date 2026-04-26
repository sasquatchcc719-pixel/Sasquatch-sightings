/**
 * AI Agent API — GET /api/agent/estimate
 * Public endpoint — no auth required.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getAgentPromoSettings } from '@/lib/agent-auth'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const serviceIds =
      searchParams.get('services')?.split(',').filter(Boolean) || []
    const quantities =
      searchParams.get('quantities')?.split(',').map(Number) || []

    if (serviceIds.length === 0) {
      return NextResponse.json(
        {
          error:
            'services query parameter is required (comma-separated service IDs)',
        },
        { status: 400, headers: CORS },
      )
    }

    const supabase = createAdminClient()
    const { data: services, error } = await supabase
      .from('service_catalog_items')
      .select('id, name, base_price, pricing_unit, default_duration_minutes')
      .in('id', serviceIds)
      .eq('is_active', true)

    if (error) throw error

    const lineItems = serviceIds
      .map((id, index) => {
        const service = services?.find((s) => s.id === id)
        if (!service) return null
        const qty = quantities[index] || 1
        return {
          service_id: service.id,
          name: service.name,
          quantity: qty,
          unit_price: Number(service.base_price || 0),
          line_total: Number(service.base_price || 0) * qty,
          duration_minutes: (service.default_duration_minutes || 60) * qty,
        }
      })
      .filter(Boolean) as Array<{
      service_id: string
      name: string
      quantity: number
      unit_price: number
      line_total: number
      duration_minutes: number
    }>

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'No valid services found for the provided IDs' },
        { status: 400, headers: CORS },
      )
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.line_total, 0)
    const totalDuration = lineItems.reduce(
      (sum, item) => sum + item.duration_minutes,
      0,
    )

    const promo = await getAgentPromoSettings()
    let promotionApplied: { code: string; discount: number } | null = null
    let total = subtotal

    if (promo.enabled && subtotal >= promo.minimum) {
      promotionApplied = { code: 'AI20', discount: promo.discount }
      total = subtotal - promo.discount
    }

    return NextResponse.json(
      {
        line_items: lineItems,
        subtotal,
        ...(promotionApplied ? { promotion_applied: promotionApplied } : {}),
        total,
        estimated_duration_minutes: totalDuration,
        note: promotionApplied
          ? `$${promo.discount} AI discount applied!`
          : promo.enabled && subtotal < promo.minimum
            ? `Add $${(promo.minimum - subtotal).toFixed(2)} more to qualify for a $${promo.discount} discount.`
            : undefined,
      },
      { headers: CORS },
    )
  } catch (err) {
    console.error('[agent/estimate] Error:', err)
    return NextResponse.json(
      { error: 'Failed to generate estimate' },
      { status: 500, headers: CORS },
    )
  }
}
