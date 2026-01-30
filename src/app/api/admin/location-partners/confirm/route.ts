/**
 * Confirm a location partner conversion and award credit
 * POST /api/admin/location-partners/confirm
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

const CREDIT_PER_CONFIRMED_BOOKING = 5 // $5 per confirmed booking

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const body = await request.json()
    const { tapId, partnerId } = body

    if (!tapId || !partnerId) {
      return NextResponse.json(
        { error: 'tapId and partnerId are required' },
        { status: 400 },
      )
    }

    // Get the tap to verify it exists and belongs to this partner
    const { data: tap, error: tapError } = await supabase
      .from('nfc_card_taps')
      .select('*')
      .eq('id', tapId)
      .eq('partner_id', partnerId)
      .single()

    if (tapError || !tap) {
      return NextResponse.json({ error: 'Tap not found' }, { status: 404 })
    }

    // Check if already confirmed
    if (tap.converted) {
      return NextResponse.json(
        { error: 'This conversion has already been confirmed' },
        { status: 400 },
      )
    }

    // Mark as confirmed
    await supabase
      .from('nfc_card_taps')
      .update({
        converted: true,
        converted_at: new Date().toISOString(),
      })
      .eq('id', tapId)

    // Get partner details
    const { data: partner, error: partnerError } = await supabase
      .from('partners')
      .select('*')
      .eq('id', partnerId)
      .single()

    if (partnerError || !partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    // Award credit
    const newBalance =
      (partner.credit_balance || 0) + CREDIT_PER_CONFIRMED_BOOKING
    const newConversions = (partner.total_conversions || 0) + 1

    await supabase
      .from('partners')
      .update({
        credit_balance: newBalance,
        total_conversions: newConversions,
      })
      .eq('id', partnerId)

    // Send SMS notification to partner
    if (partner.phone) {
      try {
        await fetch(
          `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/sms/send`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: partner.phone,
              message: `🎉 Great news! A customer from your ${partner.location_name || partner.company_name} NFC card just booked! You earned $${CREDIT_PER_CONFIRMED_BOOKING} credit. New balance: $${newBalance}. Thanks for partnering with Sasquatch!`,
            }),
          },
        )
      } catch (error) {
        console.error('Failed to send SMS notification:', error)
      }
    }

    return NextResponse.json({
      success: true,
      creditAwarded: CREDIT_PER_CONFIRMED_BOOKING,
      newBalance,
      newConversions,
    })
  } catch (error) {
    console.error('Error confirming conversion:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
