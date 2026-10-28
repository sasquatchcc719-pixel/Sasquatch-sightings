/**
 * Location Partner Login
 * POST /api/location-partner/login
 * Verify phone + PIN and return partner stats
 */

import { NextRequest, NextResponse } from 'next/server'
import { matchesWebhookSecret } from '@/lib/webhook-auth'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const { partnerId, pin } = body ?? {}

    const denied = () =>
      NextResponse.json(
        { error: 'Invalid partner ID or PIN' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
      )
    if (
      typeof partnerId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        partnerId,
      ) ||
      typeof pin !== 'string' ||
      !/^\d{4}$/.test(pin)
    )
      return denied()
    const supabase = createAdminClient()
    const { data: allowed, error: limitError } = await supabase.rpc(
      'consume_location_partner_pin_attempt',
      { p_partner_id: partnerId },
    )
    if (limitError)
      return NextResponse.json(
        { error: 'Login is temporarily unavailable' },
        { status: 503 },
      )
    if (allowed !== true)
      return NextResponse.json(
        { error: 'Too many login attempts. Try again in 15 minutes.' },
        {
          status: 429,
          headers: {
            'Retry-After': '900',
            'Cache-Control': 'private, no-store',
          },
        },
      )

    // Find the partner and verify PIN
    const { data: partner, error } = await supabase
      .from('partners')
      .select(
        'id, company_name, location_name, phone, credit_balance, total_taps, total_conversions, pin, partner_type',
      )
      .eq('id', partnerId)
      .eq('partner_type', 'location')
      .single()

    // Compare even for an unknown account; neither response reveals existence.
    const validPin = matchesWebhookSecret(
      typeof partner?.pin === 'string' ? partner.pin : '0000',
      pin,
    )
    if (error || !partner || !validPin || !partner.pin) return denied()

    // Read only this partner's aggregate counts after PIN verification.
    const [taps, bookings] = await Promise.all([
      supabase
        .from('nfc_card_taps')
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', partner.id),
      supabase
        .from('ops_appointments')
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', partner.id)
        .neq('status', 'cancelled'),
    ])
    if (taps.error || bookings.error)
      throw new Error('Partner statistics unavailable')

    // Return partner stats (without PIN)
    return NextResponse.json(
      {
        success: true,
        partner: {
          id: partner.id,
          name: partner.location_name || partner.company_name,
          phone: partner.phone,
          creditBalance: partner.credit_balance || 0,
          totalTaps: taps.count ?? 0,
          totalConversions: bookings.count ?? 0,
          // Add chart data
          tapHistory: await getTapHistory(supabase, partner.id),
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    console.error('Location partner login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

async function getTapHistory(supabase: SupabaseClient, partnerId: string) {
  // Get taps from last 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: taps, error } = await supabase
    .from('nfc_card_taps')
    .select('created_at')
    .eq('partner_id', partnerId)
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: true })
    .limit(10000)

  if (error) {
    console.error('Error fetching tap history:', error)
    return []
  }

  // Aggregate by date
  const historyMap = new Map<string, number>()

  // Initialize last 30 days with 0
  for (let i = 0; i < 30; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
    historyMap.set(dateStr, 0)
  }

  // Count actual taps
  taps?.forEach((tap) => {
    const dateStr = new Date(tap.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
    if (historyMap.has(dateStr)) {
      historyMap.set(dateStr, (historyMap.get(dateStr) || 0) + 1)
    }
  })

  // Convert to array and reverse to show oldest to newest
  return Array.from(historyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .reverse()
}
